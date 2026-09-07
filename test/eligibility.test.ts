import assert from "node:assert/strict";
import test from "node:test";
import { parseChampionsEligibility } from "../src/sources.js";

test("official eligibility parser preserves form IDs and rejects schema drift or executable content", () => {
  const wrap = (value: string) => `<script>const pokemons = ${value}; const noPrefix = 'No. {0}';</script>`;
  assert.deepEqual(parseChampionsEligibility(wrap('[["0026-000",1,"Raichu"],["0026-001",1,"Raichu (Alolan Form)"]]')), [
    { formId: "0026-000", nationalDex: 26, name: "Raichu" },
    { formId: "0026-001", nationalDex: 26, name: "Raichu (Alolan Form)" },
  ]);
  for (const value of ['[]', '[["0026-000",0,"Raichu"]]', '[["bad",1,"Raichu"]]', '[["0026-000",1,""]]', '[["0026-000",1,"Raichu"],["0026-000",1,"Raichu"]]', '[process.exit()]']) {
    assert.throws(() => parseChampionsEligibility(wrap(value)));
  }
  assert.throws(() => parseChampionsEligibility("<h1>Access denied</h1>"));
});
