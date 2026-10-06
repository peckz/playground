import Link from "next/link";
import { experiments } from "@/lib/experiments";

export default function Home() {
  return (
    <main className="w-full max-w-xl mx-auto px-4 py-16 text-sm">
      <h1 className="font-medium">Playground</h1>
      <p className="mt-1 text-muted">
        Motion and interaction experiments, open source.
      </p>

      <ul className="mt-10 flex flex-col gap-4">
        {experiments.map((experiment) => (
          <li key={experiment.slug}>
            <Link href={`/${experiment.slug}`} className="group block">
              <span className="group-hover:underline underline-offset-4">
                {experiment.title}
              </span>
              <span className="block text-muted">{experiment.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
