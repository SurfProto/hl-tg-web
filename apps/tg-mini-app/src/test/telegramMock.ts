export function installTelegramWebAppMock(initData = "signed-init-data") {
  window.Telegram = {
    WebApp: {
      initData,
      initDataUnsafe: {
        user: { id: 123, first_name: "Alice", username: "alice_tg" },
      },
    } as TelegramWebApp,
  };
}
