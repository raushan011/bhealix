/*
 * The same leave screen field staff use: it reads and writes only the signed-in
 * person's own requests (`/api/hr/leave` scopes anybody without `manageLeave`
 * to themselves), and knows nothing of which panel it is drawn in.
 */
export { default } from "@/app/employee/leave/page";
