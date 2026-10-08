import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiPost, getSession } from "./api";
import type { SessionView } from "./api";

/** Session truth lives server-side; the client polls it on a bounded
 * interval so a grant revocation or expiry surfaces without a reload. */
export function useSession() {
  return useQuery<SessionView | null, ApiError>({
    queryKey: ["session"],
    queryFn: ({ signal }) => getSession(signal),
    retry: 1,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return async (csrfToken: string) => {
    await apiPost("/api/auth/v1/logout", csrfToken).catch(() => null);
    await queryClient.invalidateQueries({ queryKey: ["session"] });
  };
}

export function isUnauthorised(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
