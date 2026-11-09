import { expect, test } from "@playwright/test";
import { FakeGitHub } from "./fake-github";
import {
  arrangeTabs,
  configure,
  launch,
  newProfileDir,
  openExtensionPage,
  readLayout,
} from "./helpers";

async function pull(local: string[], target: string[], keep: string[]): Promise<string[]> {
  const github = new FakeGitHub();
  const context = await launch(newProfileDir(), github);
  try {
    const { page: options } = await configure(context, null, "Laptop");
    await options.getByLabel("Nowy profil synchronizacji").fill("Praca");
    await options.getByRole("button", { name: "Utwórz" }).click();
    await expect(options.getByText("Wybrano profil: Praca.")).toBeVisible();

    await arrangeTabs(options, target);
    const popup = await openExtensionPage(context, "popup/index.html");
    await popup.getByRole("button", { name: "Wyślij" }).click();
    await expect(popup.getByText("Wysłano.")).toBeVisible();

    await arrangeTabs(options, local);
    const preview = await openExtensionPage(context, "preview/index.html");
    for (const name of keep) {
      await preview.getByRole("checkbox", { name: new RegExp(`${name}\\.test`) }).uncheck();
    }
    await preview.getByRole("button", { name: "Zastosuj" }).click();
    await expect(preview.getByText("Gotowe.")).toBeVisible();
    return await readLayout(preview);
  } finally {
    await context.close();
  }
}

type Scenario = {
  name: string;
  local: string[];
  target: string[];
  keep?: string[];
  expected?: string[];
};

const scenarios: Scenario[] = [
  {
    name: "a closed member does not pull the next tab into the group",
    local: ["a[1:G]", "dead[1:G]", "b[1:G]", "c"],
    target: ["a[1:G]", "b[1:G]", "c"],
  },
  {
    name: "an opened ungrouped tab does not join the group around it",
    local: ["a[1:G]", "b[1:G]"],
    target: ["a", "new", "b"],
  },
  {
    name: "a moved ungrouped tab does not join a group",
    local: ["a[1:G]", "b[1:G]", "c"],
    target: ["a", "c", "b"],
  },
  {
    name: "keeps exact order when a group loses a member",
    local: ["x", "g1a[1:G1]", "g1b[1:G1]", "y", "pin"],
    target: ["*pin", "y", "g1b[1:G1]", "new[1:G1]", "g2a[2:G2]", "x"],
  },
  {
    name: "a group survives its last member leaving first",
    local: ["x[1:Work]", "y"],
    target: ["x", "y[1:Work]"],
  },
  {
    name: "a reused group does not drag a tab to its old position",
    local: ["x[1:Work]", "y", "z"],
    target: ["y[1:Work]", "z", "x"],
  },
  {
    name: "a group emptied by closing is created again",
    local: ["dead[1:Work]", "k"],
    target: ["k[1:Work]"],
  },
  {
    name: "same-titled groups stay separate",
    local: ["a", "b", "c"],
    target: ["a[1:T]", "b[2:T]", "c"],
  },
  {
    name: "unnamed groups stay separate",
    local: ["a[1:]", "b", "c"],
    target: ["a[1:]", "b[2:]", "c"],
  },
  {
    name: "tabs swapping between groups keep both groups",
    local: ["a[1:X]", "b[2:Y]"],
    target: ["b[1:X]", "a[2:Y]"],
  },
  {
    name: "tabs reversed inside a group keep the target order",
    local: ["a[1:G]", "b[1:G]", "c[1:G]"],
    target: ["c[1:G]", "b[1:G]", "a[1:G]"],
  },
  {
    name: "groups change places",
    local: ["a[1:X]", "b[1:X]", "c[2:Y]"],
    target: ["c[1:Y]", "a[2:X]", "b[2:X]"],
  },
  {
    name: "a kept pinned tab does not break the order of later tabs",
    local: ["*k", "a", "b", "c"],
    target: ["a", "c", "b"],
    keep: ["k"],
    expected: ["*k", "a", "c", "b"],
  },
];

for (const { name, local, target, keep = [], expected = target } of scenarios) {
  test(name, async () => {
    expect(await pull(local, target, keep)).toEqual(expected);
  });
}
