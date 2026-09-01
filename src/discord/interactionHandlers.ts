export function createInteractionHandlers(gameLogic: any) {
  return {
    async handleCommand(interaction: any, facility: any) {
      if (typeof gameLogic?.handleCommand === 'function') {
        return gameLogic.handleCommand(interaction, facility);
      }
      return undefined;
    },
    async handleButton(interaction: any, facility: any) {
      if (typeof gameLogic?.handleButton === 'function') {
        return gameLogic.handleButton(interaction, facility);
      }
      return undefined;
    },
    async handleSelectMenu(interaction: any, facility: any) {
      if (typeof gameLogic?.handleSelectMenu === 'function') {
        return gameLogic.handleSelectMenu(interaction, facility);
      }
      return undefined;
    }
  };
}
