"use client";

import { useState } from "react";
import FloatingWidgetGate from "./FloatingWidgetGate";

export default function FloatingWidgetMount() {
  const [open, setOpen] = useState(false);

  const handleClose = () => setOpen(false);

  return (
    <>
      <FloatingWidgetGate
        open={open}
        setOpen={setOpen}
        onClose={handleClose}
      />
    </>
  );
}
