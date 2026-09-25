/** Registry of every source. Order here is the default display order. */

import type { Source } from "../core/types.ts";
import { fiveByFifteen } from "./5x15.ts";
import { barbican } from "./barbican.ts";
import { birkbeck } from "./birkbeck.ts";
import { frontlineClub } from "./frontline-club.ts";
import { royalSociety } from "./royal-society.ts";
import { rsa } from "./rsa.ts";
import { rsaa } from "./rsaa.ts";
import { societyOfAntiquaries } from "./society-of-antiquaries.ts";
import { charterhouse } from "./charterhouse.ts";
import { conwayHall } from "./conway-hall.ts";
import { fortean } from "./fortean.ts";
import { geologicalSociety } from "./geological-society.ts";
import { gresham } from "./gresham.ts";
import { guildhallLibrary } from "./guildhall-library.ts";
import { guardianLive } from "./guardian-live.ts";
import { howToAcademy } from "./how-to-academy.ts";
import { imperial } from "./imperial.ts";
import { kcl } from "./kcl.ts";
import { linnean } from "./linnean.ts";
import { lse } from "./lse.ts";
import { ras } from "./ras.ts";
import { rgs } from "./rgs.ts";
import { seedTalks } from "./seed-talks.ts";
import { southbank } from "./southbank.ts";
import { tate } from "./tate.ts";
import { ucl } from "./ucl.ts";

export const sources: Source[] = [fiveByFifteen, barbican, birkbeck, charterhouse, conwayHall, fortean, frontlineClub, geologicalSociety, gresham, guardianLive, guildhallLibrary, howToAcademy, imperial, kcl, linnean, lse, ras, rgs, royalSociety, rsa, rsaa, seedTalks, societyOfAntiquaries, southbank, tate, ucl];
