import { HelpContent } from "../components/HelpDrawer";

export function HowItWorksPage() {
  return (
    <>
      <p className="eyebrow">How it works</p>
      <h1 tabIndex={-1}>The data workflow</h1>
      <p className="intro">
        Load data → check coverage → detect &amp; publish → explore. Every step is explicit; nothing
        publishes automatically.
      </p>
      <section className="card">
        <HelpContent />
      </section>
    </>
  );
}
