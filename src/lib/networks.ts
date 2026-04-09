import { UserFace } from "@/types";

export type NetworkKey = "kidsMinistry" | "youthMinistry" | "youngProfessionals" | "mensNetwork" | "womensNetwork";

export type NetworkCounts = Record<NetworkKey, number>;

export const NETWORK_LABELS: Record<NetworkKey, string> = {
  kidsMinistry: "Kid's Ministry",
  youthMinistry: "Youth Ministry",
  youngProfessionals: "Young Professionals",
  mensNetwork: "Men's Network",
  womensNetwork: "Women's Network"
};

export function createEmptyNetworkCounts(): NetworkCounts {
  return {
    kidsMinistry: 0,
    youthMinistry: 0,
    youngProfessionals: 0,
    mensNetwork: 0,
    womensNetwork: 0
  };
}

export function getNetworkFromProfile(age: number | null, gender: UserFace["gender"]): NetworkKey | null {
  if (age === null || !Number.isFinite(age)) return null;

  if (age <= 13) return "kidsMinistry";
  if (age <= 26) return "youthMinistry";
  if (age <= 45) return "youngProfessionals";

  if (age <= 90) {
    if (gender === "Male") return "mensNetwork";
    if (gender === "Female") return "womensNetwork";
  }

  return null;
}

export function buildStudentNetworkMap(users: Array<Pick<UserFace, "student_id" | "age" | "gender">>) {
  const map = new Map<string, NetworkKey>();

  for (const user of users) {
    const key = getNetworkFromProfile(user.age, user.gender);
    if (key) {
      map.set(user.student_id, key);
    }
  }

  return map;
}
