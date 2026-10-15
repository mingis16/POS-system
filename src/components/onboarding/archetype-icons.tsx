import {
  Car,
  Droplets,
  Hammer,
  Pill,
  Scissors,
  Shirt,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sparkles,
  Store,
  Sun,
  Tv,
  UtensilsCrossed,
} from "lucide-react";
import type { IconName } from "@/lib/archetypes";

export const ARCHETYPE_ICONS: Record<IconName, React.ComponentType<{ className?: string }>> = {
  store: Store,
  "shopping-cart": ShoppingCart,
  utensils: UtensilsCrossed,
  shirt: Shirt,
  smartphone: Smartphone,
  tv: Tv,
  hammer: Hammer,
  droplets: Droplets,
  scissors: Scissors,
  pill: Pill,
  sofa: Sofa,
  car: Car,
  sun: Sun,
  sparkles: Sparkles,
};
