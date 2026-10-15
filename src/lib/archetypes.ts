/**
 * Business archetypes for Sierra Leone. Each one decides the words the app
 * uses, the stock units offered, which modules appear (IMEI tracking, expiry
 * dates, jobs, production...) and the starting categories and expense heads.
 *
 * The chosen archetype is snapshotted onto the business at onboarding
 * (terminology, units, modules), so later edits here never change an existing
 * business, and a custom business can define all of it itself.
 */
import type { AttributeField, BusinessModules, JobKind, LocationKind, StorageMode, Terminology } from "./types";

export type ArchetypeKey =
  | "provision_shop"
  | "supermarket"
  | "restaurant_bar"
  | "boutique"
  | "phone_shop"
  | "electronics"
  | "hardware"
  | "water_factory"
  | "salon"
  | "pharmacy"
  | "furniture"
  | "auto"
  | "solar"
  | "custom";

export type IconName =
  | "store"
  | "shopping-cart"
  | "utensils"
  | "shirt"
  | "smartphone"
  | "tv"
  | "hammer"
  | "droplets"
  | "scissors"
  | "pill"
  | "sofa"
  | "car"
  | "sun"
  | "sparkles";

export interface SampleItem {
  name: string;
  unit: string;
  category: string;
  kind?: "stock" | "service" | "raw_material";
}

export interface Archetype {
  key: ArchetypeKey;
  label: string;
  description: string;
  icon: IconName;
  terminology: Terminology;
  units: string[];
  defaultUnit: string;
  categories: string[];
  expenseCategories: string[];
  modules: BusinessModules;
  /** Extra locations suggested on top of the storage answers. */
  locations: { name: string; kind: LocationKind }[];
  /** Typical items to tick during setup; prices are left for the owner. */
  sampleItems: SampleItem[];
}

const GOODS: Terminology = {
  item: "Product",
  items: "Products",
  sale: "Sale",
  sales: "Sales",
  customer: "Customer",
  customers: "Customers",
};

export const ARCHETYPES: Archetype[] = [
  {
    key: "provision_shop",
    label: "Provision shop / Mini-mart",
    description: "Packaged goods, drinks and household items sold over the counter.",
    icon: "store",
    terminology: GOODS,
    units: ["pieces", "packets", "tins", "bottles", "cartons", "crates", "bags", "kg", "litres"],
    defaultUnit: "pieces",
    categories: ["Beverages", "Provisions", "Toiletries", "Household", "Snacks", "Cigarettes", "Top-up cards"],
    expenseCategories: ["Market dues"],
    modules: { barcode: true, wholesale: true },
    locations: [{ name: "Store room", kind: "store_room" }],
    sampleItems: [
      { name: "Coca-Cola 35cl", unit: "bottles", category: "Beverages" },
      { name: "Bottled water 75cl", unit: "bottles", category: "Beverages" },
      { name: "Peak milk (tin)", unit: "tins", category: "Provisions" },
      { name: "Sugar (1 kg)", unit: "packets", category: "Provisions" },
      { name: "Rice (50 kg bag)", unit: "bags", category: "Provisions" },
      { name: "Indomie noodles", unit: "packets", category: "Provisions" },
      { name: "Key soap", unit: "pieces", category: "Toiletries" },
    ],
  },
  {
    key: "supermarket",
    label: "Supermarket / Wholesale store",
    description: "Barcode scanning, bulk stock, cartons and batch/expiry tracking.",
    icon: "shopping-cart",
    terminology: GOODS,
    units: ["pieces", "packets", "cartons", "cases", "crates", "bags", "bundles", "kg", "litres"],
    defaultUnit: "pieces",
    categories: ["Beverages", "Groceries", "Frozen foods", "Dairy", "Toiletries", "Household", "Baby care", "Wines & spirits"],
    expenseCategories: ["Security", "Cleaning"],
    modules: { barcode: true, batches: true, expiry: true, wholesale: true },
    locations: [{ name: "Warehouse", kind: "warehouse" }],
    sampleItems: [
      { name: "Vegetable oil (5 L)", unit: "pieces", category: "Groceries" },
      { name: "Frozen chicken (carton)", unit: "cartons", category: "Frozen foods" },
      { name: "Milk powder 400g", unit: "pieces", category: "Dairy" },
      { name: "Diapers (pack)", unit: "packets", category: "Baby care" },
      { name: "Star beer (crate)", unit: "crates", category: "Wines & spirits" },
    ],
  },
  {
    key: "restaurant_bar",
    label: "Restaurant, bar or club",
    description: "Kitchen stock, cold-room and freezer tracking, table or counter service.",
    icon: "utensils",
    terminology: { item: "Menu item", items: "Menu & stock", sale: "Order", sales: "Orders", customer: "Guest", customers: "Guests" },
    units: ["plates", "bottles", "crates", "glasses", "shots", "kg", "litres", "pieces", "bags"],
    defaultUnit: "plates",
    categories: ["Food", "Soft drinks", "Beer", "Wines & spirits", "Kitchen ingredients"],
    expenseCategories: ["Cooking gas", "Entertainment & DJ"],
    modules: { tables: true, usage: true, services: true },
    locations: [
      { name: "Bar counter", kind: "shelf" },
      { name: "Kitchen", kind: "store_room" },
    ],
    sampleItems: [
      { name: "Jollof rice with chicken", unit: "plates", category: "Food", kind: "service" },
      { name: "Cassava leaf with rice", unit: "plates", category: "Food", kind: "service" },
      { name: "Star beer", unit: "bottles", category: "Beer" },
      { name: "Guinness stout", unit: "bottles", category: "Beer" },
      { name: "Coca-Cola 35cl", unit: "bottles", category: "Soft drinks" },
      { name: "Chicken (frozen)", unit: "kg", category: "Kitchen ingredients", kind: "raw_material" },
      { name: "Rice (50 kg bag)", unit: "bags", category: "Kitchen ingredients", kind: "raw_material" },
    ],
  },
  {
    key: "boutique",
    label: "Boutique, shoes & clothing",
    description: "Sizes, colours and styles, with seasonal stock.",
    icon: "shirt",
    terminology: GOODS,
    units: ["pieces", "pairs", "sets", "yards", "bundles"],
    defaultUnit: "pieces",
    categories: ["Men", "Women", "Children", "Shoes", "Bags", "Accessories", "Fabrics"],
    expenseCategories: ["Tailoring & alterations"],
    modules: {
      barcode: true,
      attributes: [
        { key: "size", label: "Size", placeholder: "M, 42, 10-12y" },
        { key: "colour", label: "Colour", placeholder: "Black" },
        { key: "style", label: "Style", placeholder: "Slim fit" },
        { key: "season", label: "Season / collection", placeholder: "Christmas 2026" },
      ],
    },
    locations: [{ name: "Store room", kind: "store_room" }],
    sampleItems: [
      { name: "Men's shirt", unit: "pieces", category: "Men" },
      { name: "Ladies' gown", unit: "pieces", category: "Women" },
      { name: "Sneakers", unit: "pairs", category: "Shoes" },
      { name: "Ankara fabric", unit: "yards", category: "Fabrics" },
    ],
  },
  {
    key: "phone_shop",
    label: "Phone & tech devices shop",
    description: "IMEI tracking, accessories, repair logs and warranties.",
    icon: "smartphone",
    terminology: { ...GOODS, job: "Repair", jobs: "Repairs" },
    units: ["pieces", "sets", "packs"],
    defaultUnit: "pieces",
    categories: ["Smartphones", "Feature phones", "Tablets", "Chargers & cables", "Earphones", "Cases & screen guards", "Power banks", "Repair parts"],
    expenseCategories: ["Repair parts & tools"],
    modules: {
      barcode: true,
      serials: true,
      serialLabel: "IMEI",
      warranty: true,
      jobs: "repair",
      usage: true,
      attributes: [
        { key: "brand", label: "Brand", placeholder: "Tecno" },
        { key: "model", label: "Model", placeholder: "Spark 20" },
        { key: "storage", label: "Storage", placeholder: "128 GB" },
        { key: "colour", label: "Colour" },
      ],
    },
    locations: [{ name: "Display case", kind: "shelf" }],
    sampleItems: [
      { name: "Tecno Spark (smartphone)", unit: "pieces", category: "Smartphones" },
      { name: "itel feature phone", unit: "pieces", category: "Feature phones" },
      { name: "USB-C charger", unit: "pieces", category: "Chargers & cables" },
      { name: "Screen protector", unit: "pieces", category: "Cases & screen guards" },
      { name: "Screen replacement (labour)", unit: "pieces", category: "Repair parts", kind: "service" },
    ],
  },
  {
    key: "electronics",
    label: "Electronics & home appliances",
    description: "Serial numbers, warranties and delivery/installation notes.",
    icon: "tv",
    terminology: { ...GOODS, job: "Delivery / installation", jobs: "Deliveries & installs" },
    units: ["pieces", "sets", "cartons"],
    defaultUnit: "pieces",
    categories: ["Televisions", "Fridges & freezers", "Fans & ACs", "Sound systems", "Kitchen appliances", "Generators", "Accessories"],
    expenseCategories: ["Delivery & installation"],
    modules: {
      serials: true,
      serialLabel: "Serial number",
      warranty: true,
      jobs: "installation",
      attributes: [
        { key: "brand", label: "Brand", placeholder: "Hisense" },
        { key: "model", label: "Model" },
        { key: "size", label: "Size / capacity", placeholder: "43 inch, 250 L" },
      ],
    },
    locations: [{ name: "Warehouse", kind: "warehouse" }],
    sampleItems: [
      { name: "43\" LED TV", unit: "pieces", category: "Televisions" },
      { name: "Chest freezer 250 L", unit: "pieces", category: "Fridges & freezers" },
      { name: "Standing fan", unit: "pieces", category: "Fans & ACs" },
      { name: "Petrol generator 3 kVA", unit: "pieces", category: "Generators" },
    ],
  },
  {
    key: "hardware",
    label: "Building materials / Hardware",
    description: "Bulky stock: bags of cement, bundles of iron rods, yards, tonnes.",
    icon: "hammer",
    terminology: GOODS,
    units: ["bags", "bundles", "lengths", "sheets", "pieces", "yards", "metres", "tonnes", "trips", "kg", "gallons", "cartons"],
    defaultUnit: "bags",
    categories: ["Cement", "Iron rods", "Roofing (zinc)", "Timber & planks", "Sand & stone", "Plumbing", "Electrical", "Paint", "Tiles", "Nails & fasteners"],
    expenseCategories: ["Loading & offloading", "Truck hire"],
    modules: { wholesale: true, usage: false },
    locations: [
      { name: "Yard", kind: "warehouse" },
      { name: "Store", kind: "store_room" },
    ],
    sampleItems: [
      { name: "Cement 50 kg (Leocem)", unit: "bags", category: "Cement" },
      { name: "Iron rod 12 mm", unit: "lengths", category: "Iron rods" },
      { name: "Iron rod 16 mm", unit: "lengths", category: "Iron rods" },
      { name: "Zinc sheet (bundle)", unit: "bundles", category: "Roofing (zinc)" },
      { name: "Sand (truck load)", unit: "trips", category: "Sand & stone" },
      { name: "Nails 4 inch", unit: "kg", category: "Nails & fasteners" },
      { name: "Emulsion paint", unit: "gallons", category: "Paint" },
    ],
  },
  {
    key: "water_factory",
    label: "Water factory (sachet / bottled)",
    description: "Production batches, daily bag and bottle counts, distribution vehicle logs.",
    icon: "droplets",
    terminology: { ...GOODS, job: "Dispatch", jobs: "Distribution" },
    units: ["bags", "cases", "bottles", "rolls", "kg", "litres", "pieces"],
    defaultUnit: "bags",
    categories: ["Sachet water", "Bottled water", "Packaging materials", "Treatment chemicals"],
    expenseCategories: ["Water treatment", "Vehicle fuel & running", "Lab testing & SLSB fees"],
    modules: { production: true, batches: true, expiry: true, jobs: "delivery", wholesale: true, usage: true },
    locations: [
      { name: "Production floor", kind: "store_room" },
      { name: "Delivery truck", kind: "vehicle" },
    ],
    sampleItems: [
      { name: "Pure water bag (30 sachets)", unit: "bags", category: "Sachet water" },
      { name: "Bottled water 75cl (case of 12)", unit: "cases", category: "Bottled water" },
      { name: "Sachet roll film", unit: "kg", category: "Packaging materials", kind: "raw_material" },
      { name: "Bottle preforms", unit: "pieces", category: "Packaging materials", kind: "raw_material" },
      { name: "Bottle caps", unit: "pieces", category: "Packaging materials", kind: "raw_material" },
    ],
  },
  {
    key: "salon",
    label: "Salon / Beauty parlour / Barbershop",
    description: "Service bookings, consumable products and staff commissions.",
    icon: "scissors",
    terminology: { item: "Service / product", items: "Services & products", sale: "Ticket", sales: "Tickets", customer: "Client", customers: "Clients", job: "Booking", jobs: "Bookings" },
    units: ["services", "pieces", "bottles", "tubes", "packs", "bundles"],
    defaultUnit: "services",
    categories: ["Hair services", "Nail services", "Barbering", "Make-up", "Hair products", "Attachments & wigs"],
    expenseCategories: [],
    modules: { services: true, commissions: true, jobs: "booking", usage: true },
    locations: [{ name: "Salon shelves", kind: "shelf" }],
    sampleItems: [
      { name: "Braiding (full head)", unit: "services", category: "Hair services", kind: "service" },
      { name: "Wash & set", unit: "services", category: "Hair services", kind: "service" },
      { name: "Haircut", unit: "services", category: "Barbering", kind: "service" },
      { name: "Manicure", unit: "services", category: "Nail services", kind: "service" },
      { name: "Relaxer cream", unit: "tubes", category: "Hair products", kind: "raw_material" },
      { name: "Braid attachment", unit: "packs", category: "Attachments & wigs" },
    ],
  },
  {
    key: "pharmacy",
    label: "Pharmacy / Chemist",
    description: "Batch expiry dates, prescription vs over-the-counter, regulated drugs.",
    icon: "pill",
    terminology: { item: "Medicine / product", items: "Medicines & products", sale: "Sale", sales: "Sales", customer: "Patient", customers: "Patients" },
    units: ["packs", "strips", "tablets", "bottles", "tubes", "vials", "sachets", "pieces"],
    defaultUnit: "packs",
    categories: ["Analgesics", "Antimalarials", "Antibiotics (Rx)", "Vitamins & supplements", "ORS & rehydration", "First aid", "Baby care", "Personal care"],
    expenseCategories: ["Pharmacy Board fees"],
    modules: { barcode: true, batches: true, expiry: true, prescriptions: true },
    locations: [{ name: "Dispensary store", kind: "store_room" }],
    sampleItems: [
      { name: "Paracetamol 500 mg", unit: "strips", category: "Analgesics" },
      { name: "Artemether-lumefantrine (Coartem)", unit: "packs", category: "Antimalarials" },
      { name: "Amoxicillin 500 mg", unit: "packs", category: "Antibiotics (Rx)" },
      { name: "ORS sachet", unit: "sachets", category: "ORS & rehydration" },
      { name: "Vitamin C 1000 mg", unit: "packs", category: "Vitamins & supplements" },
    ],
  },
  {
    key: "furniture",
    label: "Furniture shop / workshop",
    description: "Custom build orders, raw materials versus finished furniture.",
    icon: "sofa",
    terminology: { ...GOODS, job: "Custom order", jobs: "Custom orders" },
    units: ["pieces", "sets", "planks", "sheets", "yards", "litres", "kg"],
    defaultUnit: "pieces",
    categories: ["Beds", "Sofas & chairs", "Tables", "Wardrobes & cabinets", "Office furniture", "Timber", "Foam & fabric", "Fittings & varnish"],
    expenseCategories: ["Carpenter wages", "Transport of timber"],
    modules: { production: true, jobs: "custom_order", usage: true },
    locations: [
      { name: "Showroom", kind: "shelf" },
      { name: "Workshop", kind: "store_room" },
    ],
    sampleItems: [
      { name: "Double bed frame", unit: "pieces", category: "Beds" },
      { name: "3-seater sofa", unit: "pieces", category: "Sofas & chairs" },
      { name: "Mahogany plank 2x12", unit: "planks", category: "Timber", kind: "raw_material" },
      { name: "Foam 6 inch", unit: "sheets", category: "Foam & fabric", kind: "raw_material" },
      { name: "Varnish", unit: "litres", category: "Fittings & varnish", kind: "raw_material" },
    ],
  },
  {
    key: "auto",
    label: "Car dealership & auto parts",
    description: "Vehicle VINs, spare parts stock and service records.",
    icon: "car",
    terminology: { ...GOODS, job: "Service record", jobs: "Service records" },
    units: ["pieces", "sets", "litres", "pairs"],
    defaultUnit: "pieces",
    categories: ["Vehicles", "Engine parts", "Brakes", "Suspension", "Tyres", "Batteries", "Oils & lubricants", "Body parts"],
    expenseCategories: ["Clearing & shipping"],
    modules: {
      serials: true,
      serialLabel: "VIN / chassis no.",
      warranty: true,
      jobs: "service",
      usage: true,
      attributes: [
        { key: "make", label: "Make", placeholder: "Toyota" },
        { key: "model", label: "Model", placeholder: "Corolla" },
        { key: "year", label: "Year", placeholder: "2015" },
        { key: "part_no", label: "Part number" },
      ],
    },
    locations: [
      { name: "Car yard", kind: "warehouse" },
      { name: "Parts store", kind: "store_room" },
    ],
    sampleItems: [
      { name: "Toyota Corolla (used)", unit: "pieces", category: "Vehicles" },
      { name: "Brake pads (set)", unit: "sets", category: "Brakes" },
      { name: "Engine oil 4 L", unit: "pieces", category: "Oils & lubricants" },
      { name: "Car battery 70 Ah", unit: "pieces", category: "Batteries" },
    ],
  },
  {
    key: "solar",
    label: "Solar & energy",
    description: "Inverters, batteries and panels with serial numbers; installation projects.",
    icon: "sun",
    terminology: { ...GOODS, job: "Installation", jobs: "Installation projects" },
    units: ["pieces", "sets", "metres", "rolls"],
    defaultUnit: "pieces",
    categories: ["Solar panels", "Inverters", "Batteries", "Charge controllers", "Cables & accessories", "Solar lights", "Solar home systems"],
    expenseCategories: ["Installation labour"],
    modules: {
      serials: true,
      serialLabel: "Serial number",
      warranty: true,
      jobs: "installation",
      usage: true,
      attributes: [
        { key: "brand", label: "Brand" },
        { key: "capacity", label: "Capacity", placeholder: "550 W, 5 kVA, 200 Ah" },
      ],
    },
    locations: [{ name: "Warehouse", kind: "warehouse" }],
    sampleItems: [
      { name: "Solar panel 550 W", unit: "pieces", category: "Solar panels" },
      { name: "Hybrid inverter 5 kVA", unit: "pieces", category: "Inverters" },
      { name: "Lithium battery 200 Ah", unit: "pieces", category: "Batteries" },
      { name: "Solar cable 6 mm", unit: "metres", category: "Cables & accessories" },
    ],
  },
  {
    key: "custom",
    label: "Other (add your business)",
    description: "Describe your business and choose your own units and words.",
    icon: "sparkles",
    terminology: GOODS,
    units: ["pieces"],
    defaultUnit: "pieces",
    categories: [],
    expenseCategories: [],
    modules: {},
    locations: [],
    sampleItems: [],
  },
];

export const ARCHETYPE_KEYS = ARCHETYPES.map((a) => a.key) as [ArchetypeKey, ...ArchetypeKey[]];

export function getArchetype(key: string | null | undefined): Archetype {
  return ARCHETYPES.find((a) => a.key === key) ?? ARCHETYPES[ARCHETYPES.length - 1];
}

/** Units anyone can pick from when defining a custom business. */
export const COMMON_UNITS = [
  "pieces", "packets", "bottles", "tins", "cartons", "cases", "crates", "bags", "bundles", "sets", "pairs",
  "kg", "grams", "tonnes", "litres", "gallons", "metres", "yards", "rolls", "sheets", "plates", "services",
];

export const JOB_KIND_LABELS: Record<JobKind, { one: string; many: string }> = {
  repair: { one: "Repair", many: "Repairs" },
  booking: { one: "Booking", many: "Bookings" },
  installation: { one: "Installation", many: "Installations" },
  custom_order: { one: "Custom order", many: "Custom orders" },
  service: { one: "Service record", many: "Service records" },
  delivery: { one: "Dispatch", many: "Distribution" },
  general: { one: "Job", many: "Jobs" },
};

export const STORAGE_OPTIONS: { value: StorageMode; label: string; location: { name: string; kind: LocationKind } }[] = [
  { value: "shelves", label: "Shelves / counter", location: { name: "Shop shelves", kind: "shelf" } },
  { value: "freezers", label: "Freezers / fridges", location: { name: "Freezer", kind: "freezer" } },
  { value: "cold_store", label: "Cold store / cold room", location: { name: "Cold store", kind: "cold_store" } },
  { value: "warehouse", label: "Warehouse", location: { name: "Warehouse", kind: "warehouse" } },
];

export const CITIES = [
  "Freetown", "Bo", "Kenema", "Makeni", "Lungi", "Koidu", "Port Loko", "Waterloo", "Kabala", "Kailahun",
  "Magburaka", "Bonthe", "Moyamba", "Pujehun", "Kambia", "Lunsar", "Kono", "Other",
];

/** Locations for a new business: one per storage answer, then the archetype's extras. */
export function locationsFor(archetype: Archetype, storage: StorageMode[]) {
  const list: { name: string; kind: LocationKind; is_default_sale: boolean }[] = [];
  const add = (name: string, kind: LocationKind) => {
    if (!list.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      list.push({ name, kind, is_default_sale: false });
    }
  };
  // The archetype's own sales point (bar counter, display case...) comes first.
  for (const l of archetype.locations.filter((l) => l.kind === "shelf")) add(l.name, l.kind);
  for (const s of STORAGE_OPTIONS) if (storage.includes(s.value)) add(s.location.name, s.location.kind);
  for (const l of archetype.locations) add(l.name, l.kind);
  if (list.length === 0) add("Shop floor", "shelf");
  const sale = list.find((l) => l.kind === "shelf") ?? list[0];
  sale.is_default_sale = true;
  return list;
}

export function attributeFields(modules: BusinessModules): AttributeField[] {
  return modules.attributes ?? [];
}
