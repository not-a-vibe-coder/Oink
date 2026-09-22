import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <main className="grid min-h-screen place-items-center p-4 text-center">
      <div>
        <p className="font-display text-6xl font-bold">404</p>
        <p className="mt-3 text-muted-foreground">This little piggy could not find that page.</p>
        <Link
          to="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-medium text-primary-foreground"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}

function ErrorComponent({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <main className="grid min-h-screen place-items-center p-4 text-center">
      <div>
        <p className="font-display text-2xl font-bold">This page did not load.</p>
        <button
          className="mt-6 min-h-11 rounded-xl bg-primary px-4 font-medium text-primary-foreground"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#ffffff" },
      { title: "Oink — Self-Custodial Solana Wallet & Tokenized Equities" },
      {
        name: "description",
        content:
          "The self-custodial Solana wallet where your tag is your account, onboarding needs no seed phrase, and inbound payments settle atomically into your elected stock portfolio.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cedarville+Cursive&family=Inter:wght@400;500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400;1,8..60,600&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={{ background: "#ffffff", color: "#0a0a0a" }}>
      <head>
        <HeadContent />
      </head>
      <body style={{ background: "#ffffff", color: "#0a0a0a" }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors />
    </QueryClientProvider>
  );
}
