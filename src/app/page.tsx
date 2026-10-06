import PageHeader from "./components/PageHeader";
import ProjectCard from "./components/ProjectCard";
import { experiments } from "@/lib/experiments";

export default function Home() {
  return (
    <div>
      <PageHeader />

      <div className="container max-w-xl mx-auto px-4">
        <h1 className="text-xl mb-16 tracking-tight">
          Petar&apos;s Playground
        </h1>
        <div className="flex flex-col gap-4">
          {experiments.map((experiment) => (
            <ProjectCard
              key={experiment.slug}
              title={experiment.title}
              description={experiment.description}
              href={`/${experiment.slug}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
