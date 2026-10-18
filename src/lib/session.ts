/**
 * No sign-in for the local build.
 *
 * Everything runs as one operator, and edits are attributed to this name in the
 * correction history. When authentication is added back (Auth.js v5 with
 * OPERATOR / MANAGER / ADMIN, as the rest of the ERP uses), this is the single
 * place the rest of the code reads the current user from — swap the constant for
 * a real session lookup and nothing else has to change.
 */
export interface CurrentUser {
  name: string;
  role: "OPERATOR" | "MANAGER" | "ADMIN";
}

export const LOCAL_USER: CurrentUser = {
  name: "Finance",
  role: "ADMIN",
};

export async function currentUser(): Promise<CurrentUser> {
  return LOCAL_USER;
}

/** Always true locally; kept so permission checks stay in the call sites. */
export function can(): boolean {
  return true;
}
