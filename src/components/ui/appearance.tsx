"use client";

import { useEffect, useState } from "react";
import { Contrast, Monitor, Moon, Palette as PaletteIcon, Sun } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  applyPalette, applyTheme, paintBrowserChrome, readPalette, readTheme, resolveTheme,
  type Palette, type Theme
} from "@/lib/theme";

const MODES: { value: Theme; label: string; icon: typeof Sun; hint: string }[] = [
  { value: "system", label: "System", icon: Monitor, hint: "Follows the device, and turns with it at sunset" },
  { value: "light", label: "Light", icon: Sun, hint: "Light whatever the device is doing" },
  { value: "dark", label: "Dark", icon: Moon, hint: "Dark whatever the device is doing" }
];

const PALETTES: { value: Palette; label: string; icon: typeof Sun; hint: string }[] = [
  { value: "mono", label: "Black & white", icon: Contrast, hint: "Greyscale throughout — the default" },
  { value: "original", label: "Warm", icon: PaletteIcon, hint: "The brand's cream and walnut" }
];

/**
 * Where the look of the app is chosen, on every screen it has.
 *
 * A sheet rather than a dropdown, for a reason that is structural and not
 * cosmetic: this button appears in the sidebar's account row, in a mobile app
 * bar, and pinned to the corner of the login screen, and it sits inside `main`,
 * which carries an entrance animation. A `position: fixed` panel measures itself
 * against the nearest transformed ancestor rather than the viewport, so an
 * anchored popover would land in a different wrong place in each of those. The
 * modal portals out to `<body>` and is correct in all of them.
 *
 * Each press applies immediately and the sheet stays open. Appearance is the one
 * setting nobody can judge from its label — the page behind is the preview, and
 * a Save button between the tap and the change would throw that away.
 */
export function Appearance({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [palette, setPalette] = useState<Palette>("mono");

  useEffect(() => {
    setTheme(readTheme());
    setPalette(readPalette());

    /*
     * The blocking script in the head stamps the attributes before first paint
     * but cannot colour the browser's own chrome — the accurate colour needs
     * computed styles, which do not exist that early. This is that second half,
     * run once the stylesheet has landed.
     */
    paintBrowserChrome();

    // The device can change under us — a phone at sunset, a laptop on a
    // schedule — and somebody who has never chosen should follow it.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      setTheme(current => (current === "system" ? "system" : current));
      paintBrowserChrome();
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  /*
   * Nothing renders until the first effect has run. The server cannot know what
   * the device prefers, and a sun that flips to a moon on hydration is worse
   * than a beat of empty space — the placeholder holds the width so the row it
   * sits in does not jump.
   */
  if (theme === null) return <span className={`tap block ${className}`} aria-hidden />;

  const showing = resolveTheme(theme);

  return <>
    <button type="button" onClick={() => setOpen(true)}
      aria-label="Appearance" title="Appearance"
      className={`tap grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)] ${className}`}>
      {palette === "mono" ? <Contrast size={17} /> : showing === "dark" ? <Moon size={17} /> : <Sun size={17} />}
    </button>

    {open && <Modal title="Appearance" description="Applies everywhere, on this device."
      onClose={() => setOpen(false)}>
      <div className="space-y-5">
        <Choice label="Mode" options={MODES} value={theme}
          onPick={next => { applyTheme(next); setTheme(next); }} />
        <Choice label="Colour" options={PALETTES} value={palette}
          onPick={next => { applyPalette(next); setPalette(next); }} />

        <p className="text-xs text-[var(--muted)]">
          Remembered in this browser, so it stays put on this device and leaves everybody else&rsquo;s alone.
        </p>
      </div>
    </Modal>}
  </>;
}

/** One axis: a labelled row of cards, the chosen one filled. */
function Choice<T extends string>({ label, options, value, onPick }: {
  label: string;
  options: { value: T; label: string; icon: typeof Sun; hint: string }[];
  value: T;
  onPick: (value: T) => void;
}) {
  return <div>
    <p className="mb-2 text-[13px] font-medium text-[var(--ink-2)]">{label}</p>
    <div className="space-y-2">
      {options.map(({ value: option, label: name, icon: Icon, hint }) => {
        const chosen = option === value;
        return <button key={option} type="button" onClick={() => onPick(option)} aria-pressed={chosen}
          className={`flex w-full items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors ${
            chosen
              ? "border-[var(--brand)] bg-[var(--brand-soft)]"
              : "border-[var(--line-2)] hover:bg-[var(--surface-2)]"
          }`}>
          <Icon size={18} className={`shrink-0 ${chosen ? "text-[var(--brand)]" : "text-[var(--muted)]"}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{name}</span>
            <span className="block text-xs text-[var(--muted)]">{hint}</span>
          </span>
          <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${chosen ? "bg-[var(--brand)]" : ""}`} />
        </button>;
      })}
    </div>
  </div>;
}
