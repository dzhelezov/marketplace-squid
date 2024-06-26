import { BlockData } from "@subsquid/evm-processor";
import {
  Contract as ERC721Contract,
  TransferEventArgs_2,
} from "../../abi/ERC721";
import { Block, Context } from "../../eth/processor";
import {
  Account,
  Category,
  Count,
  ENS,
  Estate,
  NFT,
  Order,
  OrderStatus,
  Parcel,
  Wearable,
} from "../../model";
import { getCategory } from "./category";
import { Network } from "@dcl/schemas";
import { bigint } from "../../model/generated/marshal";
import { getAddresses } from "./addresses";
import {
  buildEstateFromNFT,
  buildParcelFromNFT,
  getAdjacentToRoad,
  getDistanceToPlaza,
  getEstateImage,
  getParcelImage,
  getParcelText,
  isInBounds,
} from "../../eth/LANDs/utils";
import { createAccount, createOrLoadAccount } from "./account";
import { Coordinate } from "../../types";
import {
  buildWearableFromNFT,
  getWearableImage,
  isWearableAccessory,
  isWearableHead,
} from "../../eth/modules/wearable";
import { buildENSFromNFT } from "../../eth/modules/ens";
import { buildCountFromNFT } from "../../eth/modules/count";

export function getNFTId(
  category: string,
  contractAddress: string,
  tokenId: string
): string {
  return category + "-" + contractAddress + "-" + tokenId;
}

export async function getTokenURI(
  ctx: Context,
  block: Block,
  contractAddress: string,
  tokenId: bigint
): Promise<string> {
  const contract = new ERC721Contract(ctx, block, contractAddress);
  const tokenURI = await contract.tokenURI(tokenId);
  return tokenURI;
}

export function updateNFTOrderProperties(nft: NFT, order: Order): void {
  if (order.status == OrderStatus.open) {
    addNFTOrderProperties(nft, order);
  } else if (
    order.status == OrderStatus.sold ||
    order.status == OrderStatus.cancelled
  ) {
    clearNFTOrderProperties(nft);
  }
}

export function addNFTOrderProperties(nft: NFT, order: Order) {
  nft.activeOrder = order;
  nft.searchOrderStatus = order.status;
  nft.searchOrderPrice = order.price;
  nft.searchOrderCreatedAt = order.createdAt;
  nft.searchOrderExpiresAt = order.expiresAt;
}

export function clearNFTOrderProperties(nft: NFT): void {
  nft.activeOrder = null;
  nft.searchOrderStatus = null;
  nft.searchOrderPrice = null;
  nft.searchOrderCreatedAt = null;
  nft.searchOrderExpiresAt = null;
}

export function cancelActiveOrder(order: Order, now: bigint): Order {
  if (order && order.status == OrderStatus.open) {
    // Here we are setting old orders as cancelled, because the smart contract allows new orders to be created
    // and they just overwrite them in place. But the subgraph stores all orders ever
    // you can also overwrite ones that are expired
    order.status = OrderStatus.cancelled;
    order.updatedAt = now;
  }
  return order;
}

export function isMint(from: string): boolean {
  return from === "0x0000000000000000000000000000000000000000"; // @TODO: enhance this check
}

export function handleTransfer(
  network: Network,
  block: BlockData,
  contractAddress: string,
  event: TransferEventArgs_2,
  accounts: Map<string, Account>,
  counts: Map<string, Count>,
  nfts: Map<string, NFT>,
  parcels: Map<string, Parcel>,
  estates: Map<string, Estate>,
  wearables: Map<string, Wearable>,
  orders: Map<string, Order>,
  ensMap: Map<string, ENS>,
  tokenURIs: Map<string, string>,
  coordinates: Map<bigint, Coordinate>
): { nft?: NFT; parcel?: Parcel; account?: Account } {
  const addresses = getAddresses(network);
  const { tokenId, to, from } = event;

  if (tokenId.toString() === "") {
    return {};
  }

  const category = getCategory(network, contractAddress);
  const id = getNFTId(category, contractAddress, tokenId.toString());

  let nft = nfts.get(id);

  if (!nft) {
    nft = new NFT({ id });
    nfts.set(id, nft);
  }

  let toAccount = accounts.get(to);
  if (!toAccount) {
    toAccount = createAccount(to);
    accounts.set(to, toAccount);
  }

  const timestamp = BigInt(block.header.timestamp / 1000);

  nft.tokenId = tokenId;
  nft.owner = toAccount;
  nft.contractAddress = Buffer.from(contractAddress.slice(2), "hex");
  nft.category = category as Category;
  nft.updatedAt = timestamp;
  nft.soldAt = null;
  nft.transferredAt = timestamp;
  nft.sales = 0;
  nft.volume = bigint.fromJSON("0");

  if (
    contractAddress !== addresses.LANDRegistry &&
    contractAddress !== addresses.EstateRegistry &&
    contractAddress !== addresses.DCLRegistrar
  ) {
    // The LANDRegistry/EstateRegistry/DCLRegistrar contracts do not have a tokenURI method
    if (!nft.tokenURI) {
      nft.tokenURI = tokenURIs.get(`${contractAddress}-${tokenId}`);
    }
  } else {
    if (contractAddress === addresses.LANDRegistry) {
      nft.tokenURI = null;
    } else {
      // this is just to accomplish the same behavior as the original subgraph code
      nft.tokenURI = "";
    }
  }

  if (isMint(from)) {
    nft.createdAt = timestamp;
    // We're defaulting "Estate size" to one to allow the frontend to search for `searchEstateSize_gt: 0`,
    // necessary because thegraph doesn't support complex queries and we can't do `OR` operations
    nft.searchEstateSize = 1;
    // We default the "in bounds" property for parcels and no-parcels alike so we can just add  `searchParcelIsInBounds: true`
    // to all queries
    nft.searchParcelIsInBounds = true;
    nft.searchText = "";
    nft.searchIsLand = false;

    const metric = buildCountFromNFT(nft, counts);
    counts.set(metric.id, metric);
  } else {
    const existingNFT = nfts.get(id);
    if (existingNFT) {
      const nftActiveOrder = existingNFT.activeOrder;
      if (nftActiveOrder) {
        const order = orders.get(nftActiveOrder.id);
        if (order) {
          cancelActiveOrder(order, timestamp);
          clearNFTOrderProperties(nft!);
        } else {
          console.log(`ERROR: Order not found ${nftActiveOrder.id}`);
        }
      }
    } else {
      console.log(`ERROR: NFT not found ${id} in handleTransfer`);
    }
  }

  if (category == Category.parcel) {
    let parcel = parcels.get(id);
    if (isMint(from)) {
      const coords = coordinates.get(tokenId);
      if (coords) {
        parcel = buildParcelFromNFT(nft, coords);
        nft.parcel = parcel;
        nft.image = getParcelImage(parcel);
        nft.searchIsLand = true;
        nft.searchParcelIsInBounds = isInBounds(parcel.x, parcel.y);
        nft.searchParcelX = parcel.x;
        nft.searchParcelY = parcel.y;
        nft.searchDistanceToPlaza = getDistanceToPlaza(parcel);
        nft.searchAdjacentToRoad = getAdjacentToRoad(parcel);
        nft.searchText = getParcelText(parcel, "");
      }
    } else {
      if (parcel) parcel.owner = nft.owner;
    }
    if (parcel) parcels.set(id, parcel);
  } else if (category == Category.estate) {
    let estate = estates.get(id);
    if (isMint(from)) {
      estate = buildEstateFromNFT(nft);
      nft.estate = estate;
      nft.image = getEstateImage(estate);
      nft.searchIsLand = true;
      nft.searchDistanceToPlaza = -1;
      nft.searchAdjacentToRoad = false;
      nft.searchEstateSize = estate.size;
    } else {
      if (estate) estate.owner = nft.owner;
    }
    if (estate) estates.set(id, estate);
  } else if (category == Category.wearable) {
    let wearable: Wearable | undefined = undefined;
    if (isMint(from)) {
      wearable = buildWearableFromNFT(nft);
      if (!!wearable.id) {
        nft.wearable = wearable;
        nft.name = wearable.name;
        nft.image = getWearableImage(wearable);
        nft.searchIsWearableHead = isWearableHead(wearable);
        nft.searchIsWearableAccessory = isWearableAccessory(wearable);
        nft.searchWearableCategory = wearable.category;
        nft.searchWearableBodyShapes = wearable.bodyShapes;
        nft.searchWearableRarity = wearable.rarity;
        nft.searchText = wearable.name.toLowerCase();
      }
    } else {
      const existingWearable = wearables.get(id);
      if (existingWearable) {
        wearable = new Wearable({ id: nft.id });
        wearable = existingWearable;
        wearable.owner = nft.owner;
      } else {
        console.log(`ERROR: Wearable not found ${id}`);
      }
    }
    if (wearable) wearables.set(id, wearable);
  } else if (category == Category.ens) {
    let ens: ENS | undefined = undefined;
    if (isMint(from)) {
      ens = buildENSFromNFT(nft);
      nft.ens = ens;
    } else {
      const existingENS = ensMap.get(id);

      if (existingENS) {
        ens = existingENS;
        ens.owner = nft.owner;
      } else {
        console.log(`ERROR: ENS not found ${id}`);
      }
    }
    if (ens) ensMap.set(id, ens);
  }

  createOrLoadAccount(accounts, to);

  return { nft, account: toAccount };
}
