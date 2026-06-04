import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;

let savedProducts = [];
let savedCollection = null;

export function getProducts() {
  return savedProducts;
}

export function saveProducts(products) {
  savedProducts = products;
  return savedProducts;
}

export function getCollection() {
  return savedCollection;
}

export function saveCollection(collection) {
  savedCollection = collection;
  return savedCollection;
}
