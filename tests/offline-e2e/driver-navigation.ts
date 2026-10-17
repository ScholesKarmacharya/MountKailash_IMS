import { type Page } from "@playwright/test";
export async function driverNavigate(page: Page, label: string) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  const nav = page.getByTestId("driver-bottom-nav");
  if (
    !["My Stock", "New Sale", "Customers", "Sales History", "More"].includes(
      label,
    )
  ) {
    await nav.getByRole("link", { name: "More", exact: true }).click();
    await page
      .getByRole("navigation", { name: "More driver actions", exact: true })
      .getByRole("link", { name: label, exact: true })
      .click();
  } else await nav.getByRole("link", { name: label, exact: true }).click();
}
export const activeScreen = (page: Page) =>
  page.locator('[data-driver-screen="true"]');
export async function driverReturn(page: Page) {
  await activeScreen(page)
    .getByRole("button", { name: "Review Return", exact: true })
    .click();
  await activeScreen(page)
    .getByRole("button", { name: "Confirm Return", exact: true })
    .click();
}
