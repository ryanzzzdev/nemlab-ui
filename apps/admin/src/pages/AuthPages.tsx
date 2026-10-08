import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import {
  applicantStatus,
  exchangeSignInToken,
  getSession,
  requestAccess,
  requestSignInLink,
  resendVerification,
  verifyAccessRequest,
} from "../api";
import { Failure, Loading, Panel } from "../components/States";
import { useSession } from "../session";

/** Reads `#token=` once, strips it from the address bar before anything
 * renders (the fragment is never sent to the server, but keeping it out of
 * history and copy-paste is cheap insurance), and returns it. */
function useFragmentToken(): string | null | undefined {
  const { hash } = useLocation();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const raw = hash.startsWith("#token=") ? hash.slice(7) : "";
    if (hash) window.history.replaceState(null, "", window.location.pathname);
    setToken(raw || null);
    // hash captured once on mount — later fragment edits are not honoured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return token;
}

function MailSent({ what }: { what: string }) {
  return (
    <Panel title="Check your email">
      <p>
        If this address can {what}, an email is on its way with a single-use link. The response is
        the same whether or not the address is known — we never confirm which accounts exist.
      </p>
    </Panel>
  );
}

function SubmitError({ error }: { error: unknown }) {
  return <Failure error={error} />;
}

export function WelcomePage() {
  const session = useSession();
  if (session.isPending) return <Loading label="Checking your session…" />;
  if (session.data && session.data.role !== "applicant") {
    return <Navigate to="/" replace />;
  }
  return (
    <>
      <p className="eyebrow">NEMLab Admin</p>
      <h1 tabIndex={-1}>Inspect and manage NEMLab data</h1>
      <p className="intro">
        The Admin console answers: what data do I have, what is missing, and how do I make it
        available? Owner sign-in and approved read-only visitor access only.
      </p>
      <div className="auth-grid">
        <Panel title="Sign in">
          <p>Owners and approved visitors sign in with a single-use email link — no passwords.</p>
          <p>
            <Link className="primary-link" to="/sign-in">
              Go to sign in
            </Link>
          </p>
        </Panel>
        <Panel title="Request read-only access">
          <p>
            New here? Ask for a read-only visitor pass — you can inspect coverage, jobs and
            publications once the owner approves you.
          </p>
          <p>
            <Link className="primary-link" to="/request-access">
              Request access
            </Link>
          </p>
        </Panel>
      </div>
      {session.data?.role === "applicant" && (
        <p className="hint">
          You already hold a request session —{" "}
          <Link to="/request-status">check your request status</Link>.
        </p>
      )}
    </>
  );
}

export function RequestAccessPage() {
  const session = useSession();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (session.isPending) return <Loading label="Checking your session…" />;
  if (session.data && session.data.role !== "applicant") {
    return <Navigate to="/" replace />;
  }
  if (session.data?.role === "applicant") {
    return <Navigate to="/request-status" replace />;
  }

  async function submit() {
    if (!displayName.trim()) {
      setFieldError("Tell us the name to show the owner.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setFieldError("Enter a valid email address — the link goes there.");
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await requestAccess({
        displayName: displayName.trim(),
        email: email.trim(),
        message: message.trim(),
      });
      setSent(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <MailSent what="request access" />;

  return (
    <>
      <p className="eyebrow">Request access</p>
      <h1 tabIndex={-1}>Ask for read-only access</h1>
      <p className="intro">
        Tell the owner who you are. If they approve, you get a sign-in link and read-only access to
        coverage, jobs and publications.
      </p>
      <section className="card scenario-form">
        <div className="scenario-fields">
          <label htmlFor="ra-name">Your name</label>
          <input
            id="ra-name"
            value={displayName}
            maxLength={80}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
          />
          <label htmlFor="ra-email">Email</label>
          <input
            id="ra-email"
            type="email"
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <label htmlFor="ra-message">Message to the owner (optional)</label>
          <textarea
            id="ra-message"
            value={message}
            maxLength={2000}
            rows={4}
            onChange={(e) => setMessage(e.target.value)}
          />
          {fieldError && (
            <p className="hint" role="alert">
              {fieldError}
            </p>
          )}
          {error !== null && <SubmitError error={error} />}
          <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
            Request access
          </button>
          <p className="hint">
            We email a verification link to this address — it expires in 24 hours and can be used
            once. Unverified requests are removed after 7 days; messages and rejected requests after
            30 days; visitor contact details 90 days after access lapses.
          </p>
        </div>
      </section>
    </>
  );
}

export function VerifyPage() {
  const token = useFragmentToken();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<"pending" | "done" | "failed">("pending");
  const attempted = useRef(false);

  useEffect(() => {
    if (token === undefined || token === null || attempted.current) return;
    attempted.current = true;
    verifyAccessRequest(token)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ["session"] });
        setResult("done");
      })
      .catch(async () => {
        // Same lost-response guard as sign-in: the token may have been
        // consumed while the reply was lost — the applicant session then
        // already exists, so re-check before declaring the link dead.
        const current = await getSession().catch(() => null);
        if (current) {
          await queryClient.invalidateQueries({ queryKey: ["session"] });
          setResult("done");
        } else {
          setResult("failed");
        }
      });
  }, [token, queryClient]);

  if (result === "done") return <Navigate to="/request-status" replace />;
  return (
    <Panel title="Verifying your request">
      {token === null || result === "failed" ? (
        <>
          <p>
            This verification link is invalid, expired or already used. Links last 24 hours and work
            once.
          </p>
          <p>
            <Link to="/request-access">Request access again</Link> or, if you already verified,{" "}
            <Link to="/request-status">check your request status</Link>.
          </p>
        </>
      ) : (
        <Loading label="Verifying your link…" />
      )}
    </Panel>
  );
}

export function RequestStatusPage() {
  const session = useSession();
  const status = useQuery({
    queryKey: ["applicant-status"],
    enabled: session.data?.role === "applicant",
    queryFn: ({ signal }) => applicantStatus(signal),
    refetchInterval: 30_000,
  });
  const [resent, setResent] = useState<string | null>(null);

  if (session.isPending) return <Loading label="Checking your session…" />;
  if (session.data && session.data.role !== "applicant") {
    return <Navigate to="/" replace />;
  }
  if (!session.data) {
    return (
      <Panel title="No request session">
        <p>
          Your request status lives behind the verification link we emailed — open it from that
          email, or <Link to="/request-access">request access</Link>.
        </p>
      </Panel>
    );
  }
  if (status.isPending) return <Loading label="Reading your request…" />;
  if (status.isError) return <Failure error={status.error} />;

  const data = status.data;
  async function resend() {
    setResent(null);
    try {
      await resendVerification(session.data!.csrfToken);
      setResent("A fresh verification email is on its way.");
    } catch {
      setResent("Could not resend right now — the link may already be used.");
    }
  }

  return (
    <>
      <p className="eyebrow">Request status</p>
      <h1 tabIndex={-1}>Your access request</h1>
      <Panel
        title={
          data.status === "approved"
            ? "Approved — check your email"
            : data.status === "rejected"
              ? "Not approved"
              : data.status === "pending"
                ? "Waiting for the owner"
                : "Verify your email"
        }
      >
        {data.status === "unverified" && (
          <p>
            Your request was received {new Date(data.submittedAt).toLocaleString("en-AU")} but the
            email address is not verified yet. Open the verification link from that email; it
            expires 24 hours after it was sent.
          </p>
        )}
        {data.status === "pending" && (
          <p>
            Your email is verified and the request is waiting for the owner. Nothing else is needed
            — an approval or decision email will arrive if the owner acts.
          </p>
        )}
        {data.status === "approved" && (
          <p>
            The owner approved read-only access
            {data.grantExpiresAt
              ? `, valid until ${new Date(data.grantExpiresAt).toLocaleString("en-AU")}`
              : ""}
            . Sign in with the link we emailed — it works once and lasts 15 minutes.
          </p>
        )}
        {data.status === "rejected" && (
          <p>
            This request was not approved. Contact the person who runs this deployment if you
            believe that is a mistake.
          </p>
        )}
        {(data.status === "unverified" || data.status === "pending") && (
          <p>
            <button type="button" className="ghost" onClick={() => void resend()}>
              Resend verification email
            </button>
          </p>
        )}
        {resent && <p className="hint">{resent}</p>}
        {data.status === "approved" && (
          <p>
            <Link className="primary-link" to="/sign-in">
              Go to sign in
            </Link>
          </p>
        )}
      </Panel>
    </>
  );
}

export function SignInPage() {
  const token = useFragmentToken();
  const session = useSession();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [exchange, setExchange] = useState<"idle" | "pending" | "done" | "failed">("idle");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    setExchange("pending");
    exchangeSignInToken(token)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ["session"] });
        setExchange("done");
      })
      .catch(async () => {
        // A lost response can still mean the exchange landed (single-use
        // tokens consume server-side first) — check before declaring the
        // link dead so the user is not stranded on a failure panel while
        // holding a live session.
        const current = await getSession().catch(() => null);
        if (current) {
          await queryClient.invalidateQueries({ queryKey: ["session"] });
          setExchange("done");
        } else {
          setExchange("failed");
        }
      });
  }, [token, queryClient]);

  if (exchange === "done" && session.data) {
    return <Navigate to="/" replace />;
  }
  if (session.data && session.data.role !== "applicant" && !token) {
    return <Navigate to="/" replace />;
  }

  async function submit() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setFieldError("Enter the email address your access was approved for.");
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await requestSignInLink(email.trim());
      setSent(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (token !== null && token !== undefined) {
    return (
      <Panel title="Signing you in">
        {exchange === "failed" ? (
          <>
            <p>
              This sign-in link is invalid, expired or already used. Links last 15 minutes and work
              once — request a fresh one below.
            </p>
            <p>
              <Link to="/sign-in">Request a new sign-in link</Link>
            </p>
          </>
        ) : (
          <Loading label="Exchanging your link…" />
        )}
      </Panel>
    );
  }

  if (sent) return <MailSent what="sign in" />;

  return (
    <>
      <p className="eyebrow">Sign in</p>
      <h1 tabIndex={-1}>Email me a sign-in link</h1>
      <p className="intro">
        No passwords — every sign-in is a single-use link that expires in 15 minutes.
      </p>
      <section className="card scenario-form">
        <div className="scenario-fields">
          <label htmlFor="si-email">Email</label>
          <input
            id="si-email"
            type="email"
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          {fieldError && (
            <p className="hint" role="alert">
              {fieldError}
            </p>
          )}
          {error !== null && <SubmitError error={error} />}
          <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
            Send sign-in link
          </button>
          <p className="hint">
            The answer is the same whether or not this address can sign in — we never reveal which
            accounts exist.
          </p>
        </div>
      </section>
    </>
  );
}
