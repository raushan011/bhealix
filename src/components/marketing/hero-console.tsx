"use client";

import { useEffect, useState } from "react";
import styles from "./landing.module.css";

/**
 * The day, replayed on a loop.
 *
 * Six things the system does on an ordinary Tuesday, arriving one at a time
 * the way they do in the real panels. It is the hero image: no screenshot ages
 * as well as the product narrating itself. Under `prefers-reduced-motion` the
 * whole day is simply shown, already complete.
 */
const DAY = [
  { time: "06:40", text: <><b>Route planned for Rahul</b> — 9 clinics, ordered by each doctor&rsquo;s call hours, not by distance.</>, note: "Arrival 10:05 at the first door. One conflict flagged, moved to Thursday." },
  { time: "10:12", text: <><b>Checked in</b> · Dr. Meera Krishnan · 2 samples · photo of the prescription pad attached.<span className={`${styles.tag} ${styles.tagOk}`}>GPS verified</span></>, note: "Stock for both samples left the shelf the same second." },
  { time: "12:58", text: <><b>Shopify order #1804</b> · ₹1,499 · coupon PRIYA30 → attributed to Priya.</>, note: "Commission 30% of ₹1,499 = ₹450 — pending until the parcel lands." },
  { time: "13:03", text: <><b>Booked with Delhivery</b> at ₹62 — cheapest of four couriers serving that PIN.<span className={`${styles.tag} ${styles.tagAmber}`}>AWB issued</span></>, note: "Label in the print queue. Customer tracking link ready." },
  { time: "17:45", text: <><b>Delivered.</b> ₹450 moves from pending to payable; Priya sees it in her portal.</>, note: "Nobody typed anything." },
  { time: "19:30", text: <><b>Retarget</b> · Adarsh bought the kit in March and never came back → called, interested, follow-up 12 Sep.</>, note: "A follow-up that surfaces on the right day, on the right phone." }
] as const;

export function HeroConsole() {
  const [shown, setShown] = useState<number>(DAY.length);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Opens with the morning already on screen, then the day arrives line by
    // line; when it is complete it starts the afternoon over rather than
    // clearing the panel, so the console is never empty.
    let count = 3;
    setShown(count);
    const tick = () => {
      count = count >= DAY.length ? 3 : count + 1;
      setShown(count);
    };
    const interval = window.setInterval(tick, 2400);
    return () => window.clearInterval(interval);
  }, []);

  return <div className={styles.console} aria-label="A day in the system, replayed">
    <div className={styles.consoleBar}>
      <span><i /><i /><i />Tuesday · live</span>
      <span className={styles.mono}>bhealix / today</span>
    </div>
    <div className={styles.consoleBody}>
      {DAY.slice(0, shown).map((entry, index) => (
        <div key={entry.time} className={`${styles.line} ${index === shown - 1 ? styles.lineNew : ""}`}>
          <span className={styles.time}>{entry.time}</span>
          <p>{entry.text}<small>{entry.note}</small></p>
        </div>
      ))}
    </div>
    <div className={styles.consoleFoot}>
      <span>3 panels · 1 database · 0 retyped</span>
      <span><b>All ledgers balanced</b></span>
    </div>
  </div>;
}
