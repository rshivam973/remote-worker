import { Dashboard } from "@/components/Dashboard";

// Deep-link to a specific job — renders the dashboard with it preselected.
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Dashboard initialJobId={id} />;
}
