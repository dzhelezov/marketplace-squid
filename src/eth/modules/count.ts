import { ONE_MILLION } from "../../common/utils/utils";
import { Category, Count, NFT, Order } from "../../model";

export const DEFAULT_ID = "all";

export function buildCount(counts: Map<string, Count>): Count {
  let count = counts.get(DEFAULT_ID);

  if (!count) {
    console.log("count not found, creating new one");
    count = new Count({ id: DEFAULT_ID });
    count.orderTotal = 0;
    count.orderParcel = 0;
    count.orderEstate = 0;
    count.orderWearable = 0;
    count.orderENS = 0;
    count.parcelTotal = 0;
    count.estateTotal = 0;
    count.wearableTotal = 0;
    count.ensTotal = 0;
    count.started = 0;
    count.salesTotal = 0;
    count.salesManaTotal = BigInt(0);
    count.creatorEarningsManaTotal = BigInt(0);
    count.daoEarningsManaTotal = BigInt(0);
    count.started = 1;
  }

  return count as Count;
}

export function buildCountFromNFT(nft: NFT, counts: Map<string, Count>): Count {
  const category = nft.category;
  const count = buildCount(counts);

  if (category == Category.parcel) {
    count.parcelTotal += 1;
  } else if (category == Category.estate) {
    count.estateTotal += 1;
  } else if (category == Category.wearable) {
    count.wearableTotal += 1;
  } else if (category == Category.ens) {
    count.ensTotal += 1;
  }

  return count;
}

export function buildCountFromOrder(order: Order, counts: Map<string, Count>) {
  const category = order.category;
  const count = buildCount(counts);
  // console.log("count.orderTotal: ", count.orderTotal);
  count.orderTotal += 1;
  // console.log("count.orderTotal +1: ", count.orderTotal);

  if (category == Category.parcel) {
    count.orderParcel += 1;
  } else if (category == Category.estate) {
    count.orderEstate += 1;
  } else if (category == Category.wearable) {
    count.orderWearable += 1;
  } else if (category == Category.ens) {
    count.orderENS += 1;
  }
}

export function buildCountFromSale(
  price: bigint,
  feesCollectorCut: bigint,
  counts: Map<string, Count>
): Count {
  const count = buildCount(counts);
  count.salesTotal += 1;
  // console.log('count.salesTotal: ', count.salesTotal);
  count.salesManaTotal = count.salesManaTotal + price;
  count.daoEarningsManaTotal =
    count.daoEarningsManaTotal + (feesCollectorCut * price) / ONE_MILLION;
  return count;
}
