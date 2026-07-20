import { expect, test } from '@playwright/test';

async function openPlayer(browser, name) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByPlaceholder('Твое имя').fill(name);
  await expect(page.getByText('Сервер подключен')).toBeVisible();
  return { context, page };
}

test('two browser sessions create a lobby, start a game and synchronize a move', async ({ browser }) => {
  const host = await openPlayer(browser, 'Хозяин');
  const guest = await openPlayer(browser, 'Гость');

  try {
    await host.page.getByRole('button', { name: 'Создать комнату' }).click();
    const roomCode = (await host.page.locator('.waiting-code b').textContent()).trim();
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);

    await guest.page.getByPlaceholder('Код комнаты').fill(roomCode);
    await guest.page.getByRole('button', { name: 'Войти' }).click();

    await expect(host.page.locator('.waiting-sidebar')).toContainText('Гость');
    await expect(guest.page.locator('.waiting-sidebar')).toContainText('Хозяин');
    await expect(host.page.getByRole('button', { name: 'Начать игру' })).toBeEnabled();

    await host.page.getByRole('button', { name: 'Начать игру' }).click();
    await expect(host.page.getByRole('button', { name: 'Походить' })).toBeVisible();
    await expect(guest.page.getByRole('button', { name: 'Походить' })).toBeVisible();

    await expect.poll(async () => Number(
      await host.page.getByText('Ваш ход', { exact: true }).isVisible(),
    ) + Number(
      await guest.page.getByText('Ваш ход', { exact: true }).isVisible(),
    )).toBe(1);
    const hostHasTurn = await host.page.getByText('Ваш ход', { exact: true }).isVisible();
    const mover = hostHasTurn ? host : guest;
    const observer = hostHasTurn ? guest : host;
    const moverName = hostHasTurn ? 'Хозяин' : 'Гость';

    await mover.page.locator('.hand-row .playing-card:not([aria-label="DVK"])').first().click();
    await mover.page.getByRole('button', { name: /Походить \(1\)/ }).click();

    await expect(observer.page.locator('.table-cards .table-card')).toHaveCount(1);
    await expect(observer.page.locator('.turn-pill')).toContainText(`Ходил: ${moverName}`);
    await expect(observer.page.getByText('Ваш ход', { exact: true })).toBeVisible();
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
