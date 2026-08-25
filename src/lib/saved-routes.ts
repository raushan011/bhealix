import { z } from "zod";
import { OBJECT_ID } from "@/lib/api";

const pointSchema = z.object({
  label: z.string().min(1),
  sublabel: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  doctorId: z.string().regex(OBJECT_ID).optional()
});

export const savedRouteInputSchema = z.object({
  name: z.string().trim().min(1, "Give this list a name").max(120),
  points: z.array(pointSchema).min(2, "Add at least two stops before saving"),
  sortMode: z.enum(["manual", "fromStart", "optimized"]).default("manual")
});
