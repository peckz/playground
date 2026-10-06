import type { Metadata } from "next";
import ChromeStudio from "./ChromeStudio";

export const metadata: Metadata = {
  title: "Chrome - Three dots, one logo",
  description: "The menu dots spin up and morph into the Chrome logo",
};

export default function ChromePage() {
  return <ChromeStudio />;
}
