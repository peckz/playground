import Link from "next/link";

interface ProjectCardProps {
  title: string;
  description: string;
  href: string;
}

export default function ProjectCard(props: ProjectCardProps) {
  return (
    <Link
      href={props.href}
      className="link-item no-underline flex flex-col border-l-2 border-gray-200 py-1 px-4 before:bg-blue-600 hover:cursor-pointer"
    >
      <span className="text-sm font-medium">{props.title}</span>
      <span className="text-sm text-muted">{props.description}</span>
    </Link>
  );
}
