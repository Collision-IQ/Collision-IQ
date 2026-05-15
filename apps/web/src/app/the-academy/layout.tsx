import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Academy",
  description:
    "Professional services from Collision Academy, with clear paths into Collision IQ and Technical Systems.",
};

export default function TheAcademyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
