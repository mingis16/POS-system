/**
 * Small RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF) for item
 * imports, plus header normalisation so "Selling Price", "selling_price" and
 * "Price" all land in the same column.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === "," || c === ";" || c === "\t") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const ALIASES: Record<string, string> = {
  name: "name",
  item: "name",
  item_name: "name",
  product: "name",
  product_name: "name",
  description: "name",
  category: "category",
  group: "category",
  unit: "unit",
  uom: "unit",
  kind: "kind",
  type: "kind",
  sku: "sku",
  code: "sku",
  item_code: "sku",
  barcode: "barcode",
  ean: "barcode",
  cost: "cost_price",
  cost_price: "cost_price",
  buying_price: "cost_price",
  purchase_price: "cost_price",
  price: "selling_price",
  selling_price: "selling_price",
  sale_price: "selling_price",
  retail_price: "selling_price",
  wholesale: "wholesale_price",
  wholesale_price: "wholesale_price",
  reorder: "reorder_level",
  reorder_level: "reorder_level",
  reorder_point: "reorder_level",
  min_stock: "reorder_level",
  reorder_qty: "reorder_qty",
  order_qty: "reorder_qty",
  qty: "opening_qty",
  quantity: "opening_qty",
  stock: "opening_qty",
  opening_qty: "opening_qty",
  opening_stock: "opening_qty",
  on_hand: "opening_qty",
};

export function normaliseHeader(h: string): string | null {
  const key = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return ALIASES[key] ?? null;
}

/** CSV text → objects keyed by our column names. Unknown columns are ignored. */
export function csvToItems(text: string): { rows: Record<string, string>[]; unknownHeaders: string[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], unknownHeaders: [] };
  const keys = header.map(normaliseHeader);
  const unknownHeaders = header.filter((_, i) => !keys[i]);
  const rows = body.map((cells) => {
    const obj: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (k && cells[i] !== undefined) obj[k] = cells[i].trim();
    });
    return obj;
  });
  return { rows: rows.filter((r) => r.name), unknownHeaders };
}

export const CSV_TEMPLATE =
  "name,category,unit,sku,barcode,cost_price,selling_price,wholesale_price,reorder_level,reorder_qty,opening_qty\n" +
  "Coca-Cola 35cl,Beverages,bottles,COKE35,5449000000996,8,12,10,24,48,48\n" +
  "Rice 50kg bag,Provisions,bags,RICE50,,700,780,760,2,10,5\n";
