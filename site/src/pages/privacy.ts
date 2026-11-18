import { runChannelPage } from './channel';
import '../styles/roles.css';
import { initRoles } from '../ui/roles';

runChannelPage(({ reduce }) => initRoles(document.querySelector('[data-roles]'), reduce));
