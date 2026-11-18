import { runChannelPage } from './channel';
import '../styles/demos/songs.css';
import { initSongsDemo } from '../ui/demos/songs';

runChannelPage(({ reduce }) => initSongsDemo(document.querySelector('[data-songs-demo]'), reduce));
