import type { Metadata } from "next";
import WifiToggleStudio from "./WifiToggleStudio";

export const metadata: Metadata = {
  title: "Wifi toggle - Search, load, connect",
  description: "Wifi that searches, loads and connects with a checkmark",
};

type WifiTogglePageProps = {
  searchParams: Promise<{ record?: string }>;
};

export default async function WifiTogglePage(props: WifiTogglePageProps) {
  const searchParams = await props.searchParams;
  return <WifiToggleStudio record={searchParams.record !== undefined} />;
}
