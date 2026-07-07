// MOTOR DaaS sandbox coverage manifest — the 15 vehicles included in the
// limited sandbox (per the MOTOR DaaS Sandbox document). Vehicle metadata only;
// no credentials. Vehicle-specific MOTOR routes may ONLY be called for these.

import type { MotorSandboxVehicle } from "@/lib/vendor/motor/motorTypes";

export const MOTOR_SANDBOX_VEHICLES: readonly MotorSandboxVehicle[] = [
  { motorVehicleId: 1872, vcdbBaseVehicleId: 1939, year: 1997, make: "Dodge", model: "Neon", vin: "1B3ES47Y6VD205309" },
  { motorVehicleId: 5108, vcdbBaseVehicleId: 5264, year: 2002, make: "Ford", model: "Explorer", vin: "1FMZU74W22UC09718" },
  { motorVehicleId: 20680, vcdbBaseVehicleId: 30027, year: 2009, make: "Chevrolet", model: "Silverado 1500", vin: "1GCEK29079E143364" },
  { motorVehicleId: 20790, vcdbBaseVehicleId: 30144, year: 2009, make: "Dodge", model: "Ram 1500", vin: "1D3HV13T39S713967" },
  { motorVehicleId: 20957, vcdbBaseVehicleId: 30390, year: 2010, make: "Toyota", model: "Camry", vin: "4T4BF3EK8AR074927" },
  { motorVehicleId: 20969, vcdbBaseVehicleId: 30402, year: 2010, make: "Chevrolet", model: "Camaro", vin: "2G1FT1EW3A9111145" },
  { motorVehicleId: 22055, vcdbBaseVehicleId: 92758, year: 2010, make: "Dodge", model: "Challenger", vin: "2B3CJ7DW1AH173347" },
  { motorVehicleId: 22124, vcdbBaseVehicleId: 95946, year: 2010, make: "Honda", model: "Civic", vin: "19XFA1F51AE028415" },
  { motorVehicleId: 22147, vcdbBaseVehicleId: 95971, year: 2010, make: "Ford", model: "F-250 Super Duty", vin: "1FTSW2BR0AEB13613" },
  { motorVehicleId: 22156, vcdbBaseVehicleId: 95980, year: 2010, make: "Nissan", model: "Altima", vin: "1N4AL2AP6AN555869" },
  { motorVehicleId: 22203, vcdbBaseVehicleId: 96028, year: 2010, make: "Mercedes-Benz", model: "C350", vin: "WDDGF5GBXAR126533" },
  { motorVehicleId: 26332, vcdbBaseVehicleId: 118906, year: 2012, make: "Ford", model: "F-150", vin: "1FTFW1ET1CFA84056" },
  { motorVehicleId: 60180, vcdbBaseVehicleId: 136724, year: 2016, make: "Freightliner", model: "Cascadia", vin: "3AKJGLD56GSGJ2574" },
  { motorVehicleId: 64112, vcdbBaseVehicleId: 141113, year: 2015, make: "Hino", model: "338", vin: "5PVNV8JRXF4S50916" },
  { motorVehicleId: 22258, vcdbBaseVehicleId: 96087, year: 2010, make: "Acura", model: "MDX", vin: "2HNYD2H47AH532332" },
] as const;
