import type { ReactNode } from "react";

type PageProps = {
  title: string;
  heading: string;
  eyebrow: string;
  introduction: string;
  children: ReactNode;
};

export function Page({ title, heading, eyebrow, introduction, children }: PageProps) {
  return (
    <>
      <title>{title}</title>
      <p className="eyebrow">{eyebrow}</p>
      <h1 tabIndex={-1}>{heading}</h1>
      <p className="intro">{introduction}</p>
      {children}
    </>
  );
}
