import { DecryptError } from "../../shared/crypto";
import { GitHubError, type GitHubErrorKind } from "../../shared/github";
import { InvalidSnapshotError } from "../../shared/snapshot";

const GITHUB_MESSAGES: Record<GitHubErrorKind, string> = {
  auth: "Token GitHub jest nieprawidłowy lub wygasł. Sprawdź konfigurację.",
  forbidden: "Token nie ma uprawnień do repozytorium. Nadaj mu Contents: Read and write.",
  "not-found": "Nie znaleziono repozytorium. Sprawdź konfigurację i uprawnienia tokenu.",
  conflict: "Dane w repozytorium właśnie się zmieniły. Spróbuj ponownie.",
  "rate-limit": "Przekroczono limit GitHub. Spróbuj ponownie później.",
  network: "Brak połączenia z GitHubem.",
  unknown: "GitHub zwrócił nieoczekiwany błąd.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof GitHubError) return GITHUB_MESSAGES[error.kind];
  if (error instanceof DecryptError)
    return "Nie udało się odszyfrować danych. Sprawdź klucz szyfrowania.";
  if (error instanceof InvalidSnapshotError) return "Dane w repozytorium są nieprawidłowe.";
  return `Wystąpił błąd: ${String(error)}`;
}
