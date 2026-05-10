import { redirect } from "next/navigation";

type StudioPageProps = {
  searchParams: Promise<{ generate?: string }>;
};

export default async function StudioPage({ searchParams }: StudioPageProps) {
  const params = await searchParams;

  redirect(params.generate === "1" ? "/generate/ai-plan" : "/generate/storyboard");
}
