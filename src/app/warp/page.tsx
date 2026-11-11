import type { Metadata } from "next";
import WarpStudio from "./WarpStudio";

export const metadata: Metadata = {
  title: "Warp 3D icon - Tilts with your cursor",
  description:
    "The Warp icon as two glass blocks in three.js, with live glow, shadows and frosted glass",
};

export default function WarpPage() {
  return <WarpStudio />;
}
