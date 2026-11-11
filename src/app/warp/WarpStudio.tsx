"use client";

import { useEscapeToHome } from "@/lib/useEscapeToHome";
import WarpStage from "./WarpStage";

/** The experiment page: the stage takes the whole window */
export default function WarpStudio() {
  useEscapeToHome();
  return <WarpStage className="fixed inset-0 touch-none" />;
}
