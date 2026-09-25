/**
 * Registry of every source, alphabetical by display name (ignoring "The").
 * To add a source: create scraper/sources/<id>.ts exporting a Source, add it
 * here, and run `npm run scrape -- --only=<id> --print`.
 */

import type { Source } from "../core/types.ts";
import { fiveByFifteen } from "./5x15.ts";
import { barbican } from "./barbican.ts";
import { birkbeck } from "./birkbeck.ts";
import { britishAcademy } from "./british-academy.ts";
import { charterhouse } from "./charterhouse.ts";
import { conwayHall } from "./conway-hall.ts";
import { fortean } from "./fortean.ts";
import { frontlineClub } from "./frontline-club.ts";
import { geologicalSociety } from "./geological-society.ts";
import { gresham } from "./gresham.ts";
import { guardianLive } from "./guardian-live.ts";
import { guildhallLibrary } from "./guildhall-library.ts";
import { hlsi } from "./hlsi.ts";
import { howToAcademy } from "./how-to-academy.ts";
import { imperial } from "./imperial.ts";
import { iop } from "./iop.ts";
import { intelligenceSquared } from "./intelligence-squared.ts";
import { kcl } from "./kcl.ts";
import { linnean } from "./linnean.ts";
import { lse } from "./lse.ts";
import { pintsOfKnowledge } from "./pints-of-knowledge.ts";
import { ras } from "./ras.ts";
import { rgs } from "./rgs.ts";
import { royalAcademy } from "./royal-academy.ts";
import { royalSociety } from "./royal-society.ts";
import { rsa } from "./rsa.ts";
import { rsaa } from "./rsaa.ts";
import { rsc } from "./rsc.ts";
import { rsm } from "./rsm.ts";
import { sas } from "./sas.ts";
import { seedTalks } from "./seed-talks.ts";
import { societyOfAntiquaries } from "./society-of-antiquaries.ts";
import { southbank } from "./southbank.ts";
import { tate } from "./tate.ts";
import { ucl } from "./ucl.ts";

export const sources: Source[] = [
  fiveByFifteen,
  barbican,
  birkbeck,
  britishAcademy,
  charterhouse,
  conwayHall,
  geologicalSociety,
  gresham,
  guardianLive,
  guildhallLibrary,
  hlsi,
  howToAcademy,
  imperial,
  iop,
  intelligenceSquared,
  kcl,
  linnean,
  fortean,
  frontlineClub,
  lse,
  pintsOfKnowledge,
  royalAcademy,
  ras,
  rgs,
  royalSociety,
  rsc,
  rsm,
  rsaa,
  rsa,
  sas,
  seedTalks,
  societyOfAntiquaries,
  southbank,
  tate,
  ucl,
];
