import { runChannelPage } from './channel';
import '../styles/demos/money.css';
import { initMoneyDemo } from '../ui/demos/money';

runChannelPage(({ reduce }) => initMoneyDemo(document.querySelector('[data-money-demo]'), reduce));
