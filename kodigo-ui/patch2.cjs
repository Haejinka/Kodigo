
const fs = require('fs');
const path = './src/pages/SettingsPage.tsx';
let code = fs.readFileSync(path, 'utf8');
code = code.replace(
  } catch (e) {
      toast('error', 'An error occurred while creating store');
    },
  } catch (e: any) {
      toast('error', e.message || 'An error occurred while creating store');
    }
);
fs.writeFileSync(path, code);

