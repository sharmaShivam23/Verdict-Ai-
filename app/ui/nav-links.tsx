"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBot, IconCode, IconGauge, IconPlug, IconStore } from "./icons";

const WORKSPACE = [
  { href: "/", label: "Experiments", icon: IconGauge },
  { href: "/agent", label: "Agent", icon: IconBot },
];
const SETUP = [
  { href: "/integrate", label: "Integrate a website", icon: IconCode },
  { href: "/connect", label: "Connect", icon: IconPlug },
  { href: "/demo", label: "Demo store", icon: IconStore },
];

export default function NavLinks() {
  const path = usePathname();
  const item = (l: (typeof WORKSPACE)[number]) => {
    const Icon = l.icon;
    const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
    return (
      <Link key={l.href} href={l.href} className="nav-link" aria-current={active ? "page" : undefined}>
        <Icon />
        {l.label}
      </Link>
    );
  };
  return (
    <nav aria-label="Main" style={{ display: "contents" }}>
      <div className="nav-label">Workspace</div>
      {WORKSPACE.map(item)}
      <div className="nav-label">Setup</div>
      {SETUP.map(item)}
    </nav>
  );
}
