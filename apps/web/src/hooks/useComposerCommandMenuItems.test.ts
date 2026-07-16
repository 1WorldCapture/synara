import type { ProviderNativeCommandDescriptor, ProviderSkillDescriptor } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { filterProviderNativeCommandsForManagedSkills } from "./useComposerCommandMenuItems";

const command = (name: string): ProviderNativeCommandDescriptor => ({ name });
const skill = (scope: string): ProviderSkillDescriptor => ({
  name: "canvas",
  path: `/tmp/${scope}/canvas/SKILL.md`,
  enabled: true,
  scope,
});

describe("filterProviderNativeCommandsForManagedSkills", () => {
  it("reserves canvas for the managed Skill while preserving every other native command", () => {
    expect(
      filterProviderNativeCommandsForManagedSkills(
        [command("review"), command("Canvas"), command("commit")],
        [skill("synara-builtin")],
      ).map((item) => item.name),
    ).toEqual(["review", "commit"]);
  });

  it("does not suppress native canvas for an ordinary user-defined Skill", () => {
    expect(
      filterProviderNativeCommandsForManagedSkills([command("canvas")], [skill("synara")]),
    ).toHaveLength(1);
  });
});
