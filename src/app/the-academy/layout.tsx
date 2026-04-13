import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Academy",
  description:
    "Technical systems, training, and membership pathways connected to Collision IQ.",
};

export default function TheAcademyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
