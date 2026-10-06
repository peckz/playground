import Link from "next/link";

interface PageHeaderProps {
  back?: boolean;
  children?: React.ReactNode;
}

export default function PageHeader(props: PageHeaderProps) {
  return (
    <div className="max-w-xl mx-auto p-4 mb-32">
      <header className="text-sm text-muted flex justify-between">
        <nav>
          {props.back ? (
            <Link href="/" className="hover:text-foreground">
              {"<———"}
            </Link>
          ) : (
            "———"
          )}
        </nav>
        {props.children}
      </header>
    </div>
  );
}
