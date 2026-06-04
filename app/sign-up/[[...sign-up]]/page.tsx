import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 border-l-2 border-amber pl-4">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-amber">PR Factory</div>
          <h1 className="mt-2 text-2xl font-black text-ink">Create your operator account</h1>
        </div>
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/"
          appearance={{
            elements: {
              rootBox: "w-full",
              cardBox: "w-full",
              card: "w-full rounded-none border border-line-bright bg-panel shadow-2xl shadow-black/50",
              headerTitle: "font-mono uppercase tracking-[0.18em]",
              formButtonPrimary:
                "rounded-sm bg-amber text-black hover:bg-amber-deep font-bold uppercase tracking-[0.14em]",
              footerActionLink: "text-amber hover:text-amber-deep",
            },
          }}
        />
      </div>
    </main>
  );
}
