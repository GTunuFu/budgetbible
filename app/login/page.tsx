import LoginForm from "./form";

export default function LoginPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="eyebrow mb-2">Budget Bible</div>
        <h1 className="figure text-4xl mb-8">Welcome back.</h1>
        <LoginForm />
      </div>
    </main>
  );
}
