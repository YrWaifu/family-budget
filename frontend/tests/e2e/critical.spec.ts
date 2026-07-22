import { expect, test } from "@playwright/test";

test("critical family budget flow", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Профиль 1").fill("Аня");
  await page.getByPlaceholder("PIN").first().fill("1111");
  await page.getByPlaceholder("Профиль 2").fill("Саша");
  await page.getByPlaceholder("PIN").nth(1).fill("2222");
  await page.getByRole("button", { name: "Создать профили" }).click();
  await page.getByRole("button", { name: /Аня/ }).click();
  await page.getByPlaceholder("PIN").fill("1111");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText("Расходы месяца")).toBeVisible();
  await page.getByRole("button", { name: /Продукты/ }).click();
  await page.getByRole("button", { name: "1" }).click();
  await page.getByRole("button", { name: "5" }).click();
  await page.getByRole("button", { name: "0" }).click();
  await page.getByRole("button", { name: "Готово" }).click();
  await expect(page.getByText(/Продукты/)).toBeVisible();
  await page.getByRole("link", { name: /История/ }).click();
  await expect(page.getByText(/-150/)).toBeVisible();
});

