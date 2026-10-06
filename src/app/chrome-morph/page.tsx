import type { Metadata } from "next";
import ChromeStudio from "./ChromeStudio";

export const metadata: Metadata = {
  title: "Chrome - Three dots, one logo",
  description: "The menu dots spin up and morph into the Chrome logo",
};

type ChromePageProps = {
  searchParams: Promise<{ record?: string }>;
};

export default async function ChromePage(props: ChromePageProps) {
  const searchParams = await props.searchParams;
  return <ChromeStudio record={searchParams.record !== undefined} />;
}
