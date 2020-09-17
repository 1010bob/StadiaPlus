import { Component } from '../Component';
import Logger from '../Logger';
import Util from '../util/Util';
import './styles/LibraryFilter.scss';
import { Snackbar } from '../ui/Snackbar';
import { Select, SelectStyle } from '../ui/Select';
import { WebDatabase } from '../WebDatabase';
import { Checkbox, CheckboxShape } from '../ui/Checkbox';
import { Language } from '../Language';
import { SyncStorage, LocalStorage } from '../Storage';
import { Shortcut } from '../Shortcut';
import { Modal } from '../ui/Modal';
import '../ui/styles/Button.scss';
import { StadiaPlusDBHook } from './StadiaPlusDBHook';
import { StadiaPlusDB } from '../StadiaPlusDB';
import { StadiaGameDB } from '../StadiaGameDB';
import { $el } from '../util/ElGen';
import { drop } from '../../docs/assets/js/main';

const { chrome, Array } = window as any;

/**
 * A filtering system allowing hiding and showing specific games in your library as well as ordering them by name.
 *
 * @export the LibraryFilter type
 * @class LibraryFilter
 * @extends {Component}
 */
export class LibraryFilter extends Component {
    /**
     * The component tag, used in language files.
     */
    tag: string = 'library-filter';

    /**
     * List of games and game data imported from the DOM
     */
    games: LibraryGame[] = [];
    sorted: LibraryGame[] = [];

    /**
     * Snackbar used to display messages when hiding and showing games
     */
    snackbar: Snackbar;

    /**
     * Filter bar allowing for controls of the library filter
     */
    filterBar: HTMLElement;

    /**
     * Select box used to order the games
     */
    select: Select;

    /**
     * Current filtering order
     */
    order: FilterOrder;

    /**
     * Should all games be shown regardless if theyre hidden or not?
     */
    showAll: boolean;

    /**
     * Checkbox showing hidden games.
     */
    checkbox: HTMLElement;

    /**
     * Direction of which games will be ordered.
     */
    direction: OrderDirection;

    /**
     * A list of all games in your library.
     */
    gameTiles: NodeList;

    /**
     * UI Modal
     */
    modal: Modal;

    /**
     * Web Scraper
     */
    db: StadiaPlusDBHook;

    searchColumn: HTMLElement;
    gameContainer: HTMLElement;

    tagSelect: Select;
    onlineTypeSelect: Select;

    constructor(snackbar: Snackbar, modal: Modal, webScraper: StadiaPlusDBHook) {
        super();

        // Import snackbar from index.js
        this.snackbar = snackbar;

        this.modal = modal;

        this.db = webScraper;
    }

    /**
     * Get the game UUID from it's jslog attribute.
     *
     * @param {Element} tile
     * @returns
     * @memberof LibraryFilter
     */
    getUUID(tile: Element) {
        return tile
            .getAttribute('jslog')
            .split('; ')[1]
            .substring(3);
    }

    /**
     * Runs when the component has loaded
     *
     * @memberof LibraryFilter
     */
    async onStart() {
        this.active = true;
        this.updateRenderer();

        if ((await SyncStorage.LIBRARY_SORT_ORDER.get()) == null)
            await SyncStorage.LIBRARY_SORT_ORDER.set(FilterOrder.RECENT.id);

        Logger.component(Language.get('component.enabled', { name: this.name }));

        const gameTiles = this.renderer.querySelectorAll('.GqLi4d');
        this.games = await SyncStorage.LIBRARY_GAMES.get();

        if (!(this.games instanceof Array)) {
            this.games = [];
        }

        (this.renderer.querySelector('.fJrLJb') as HTMLElement).style['display'] = 'none';

        await this.createContainer();

        for (const gameTile of gameTiles) {
            const uuid = this.getUUID(gameTile);
            const game: LibraryGame = new LibraryGame(uuid);

            game.create().then(() => {
                if (this.games.find((e) => e.uuid === uuid) == null) {
                    this.games.push(game);
                }
            });
        }

        this.resortGames();
    }

    updateGames(sorted: LibraryGame[]) {
        for (const game of sorted) {
            if (
                this.gameContainer.querySelector('.stadiaplus_libraryfilter-game[data-uuid="' + game.uuid + '"]') ==
                null
            ) {
                const tile = game.createTile();

                let playerURL: any = location.href.split('/');
                playerURL[playerURL.length - 1] = 'player/' + game.uuid;
                playerURL = playerURL.join('/');

                tile.addEventListener('click', () => {
                    location.href = playerURL;
                });

                this.gameContainer.appendChild(tile);
                tile.style.backgroundSize = `auto ${tile.offsetHeight + 16}px`; // Add arbitrary magic number to make sure there aren't visible borders

                const listGame = $el('div')
                    .class({ 'stadiaplus_libraryfilter-listgame': true })
                    .attr({ 'data-uuid': game.uuid })
                    .child($el('hr'))
                    .child(
                        $el('h6')
                            .text(game.name)
                            .child(
                                $el('i')
                                    .class({ 'material-icons-extended': true })
                                    .text('keyboard_arrow_right')
                            )
                    ).element;

                listGame.addEventListener('click', () => {
                    location.href = playerURL;
                });

                this.searchColumn.appendChild(listGame);
            }
        }
    }

    async resortGames() {
        for (const game of this.renderer.querySelectorAll(
            '.stadiaplus_libraryfilter-game, .stadiaplus_libraryfilter-listgame'
        )) {
            game.setAttribute('old', '');
            game.setAttribute('data-uuid', '');
        }

        (this.renderer.querySelector('.stadiaplus_libraryfilter-searchcolumn-bar>input') as any).value = '';

        this.renderer.querySelector('.stadiaplus_libraryfilter-sortorderindicator').textContent = FilterOrder.from(
            await SyncStorage.LIBRARY_SORT_ORDER.get()
        ).name;
        await this.updateGames(await this.getSortedGames());
        this.renderer
            .querySelectorAll('.stadiaplus_libraryfilter-game[old], .stadiaplus_libraryfilter-listgame[old]')
            .forEach((e) => e.remove());

        this.updateVisibility();
    }

    async updateVisibility() {
        const tags = (this.tagSelect.get() as string[]).map((id) => StadiaGameDB.Tag.fromId(id));
        const onlineTypes = (this.onlineTypeSelect.get() as string[]).map((id) => StadiaGameDB.OnlineType.fromId(id));

        if (tags.length === 0 && onlineTypes.length === 0) {
            document.querySelector('.stadiaplus_libraryfilter-visibilityindicator').textContent = 'All';
        } else {
            document.querySelector('.stadiaplus_libraryfilter-visibilityindicator').textContent = 'Custom';
        }

        for (const game of this.games) {
            const sgdb = StadiaGameDB.get(game.uuid);
            let visible = true;

            for (const tag of tags) {
                if (sgdb.tags.find((e) => e.id == tag.id) == null) {
                    visible = false;
                }
            }

            for (const type of onlineTypes) {
                if (sgdb.onlineTypes.find((e) => e.id == type.id) == null) {
                    visible = false;
                }
            }

            const tile = document.querySelector(`.stadiaplus_libraryfilter-game[data-uuid="${game.uuid}"]`);
            const entry = document.querySelector(`.stadiaplus_libraryfilter-listgame[data-uuid="${game.uuid}"]`);
            if (tile != null) tile.classList.toggle('hidden', !visible);
            if (entry != null) entry.classList.toggle('hidden', !visible);
        }
    }

    async createContainer() {
        const root = this.renderer.querySelector('.z1P2me');

        const search = $el('input').element;
        search.addEventListener('input', () => {
            const val = (search as any).value;

            this.renderer.querySelectorAll('.stadiaplus_libraryfilter-game').forEach((element: HTMLElement) => {
                const name = StadiaGameDB.get(element.getAttribute('data-uuid')).name;

                if (!name.toLowerCase().includes(val.toLowerCase())) {
                    element.style['display'] = 'none';
                } else {
                    element.style['display'] = null;
                }
            });

            this.renderer.querySelectorAll('.stadiaplus_libraryfilter-listgame').forEach((element: HTMLElement) => {
                const name = element.querySelector('h6').textContent;

                if (!name.toLowerCase().includes(val.toLowerCase())) {
                    element.style['display'] = 'none';
                } else {
                    element.style['display'] = null;
                }
            });
        });

        this.searchColumn = $el('div')
            .class({ 'stadiaplus_libraryfilter-searchcolumn': true })
            .child(
                $el('div')
                    .class({ 'stadiaplus_libraryfilter-searchcolumn-bar': true })
                    .child(
                        $el('i')
                            .class({ 'material-icons-extended': true })
                            .text('search')
                    )
                    .child(search)
            ).element;

        this.gameContainer = $el('div').class({ 'stadiaplus_libraryfilter-gamecontainer': true }).element;

        $el('h2')
            .text('Your Games')
            .css({ 'margin-top': '8rem' })
            .appendTo(root);

        window.addEventListener('click', () => {
            this.renderer.querySelectorAll('.stadiaplus_libraryfilter-dropdown').forEach((e) => {
                e.classList.remove('selected');
            });
        });

        const orderDropdown = this.getOrderDropdown();
        const visibleDropdown = this.getVisibleDropdown();
        $el('div')
            .class({ 'stadiaplus_libraryfilter-bar': true })
            .child(
                $el('div')
                    .event({
                        click: (event) => {
                            for (const e of this.renderer.querySelectorAll('.stadiaplus_libraryfilter-dropdown')) {
                                e.classList.remove('selected');
                            }
                            orderDropdown.classList.add('selected');
                            event.stopPropagation();
                        },
                    })
                    .child(
                        $el('h6')
                            .class({ 'stadiaplus_libraryfilter-sortorderindicator': true })
                            .text(FilterOrder.from(await SyncStorage.LIBRARY_SORT_ORDER.get()).name)
                    )
                    .child(
                        $el('i')
                            .class({ 'material-icons-extended': true })
                            .text('keyboard_arrow_down')
                    )
                    .child(orderDropdown)
            )
            .child(
                $el('div')
                    .event({
                        click: (event) => {
                            for (const e of this.renderer.querySelectorAll('.stadiaplus_libraryfilter-dropdown')) {
                                e.classList.remove('selected');
                            }
                            visibleDropdown.classList.add('selected');
                            event.stopPropagation();
                        },
                    })
                    .child(
                        $el('h6')
                            .class({ 'stadiaplus_libraryfilter-visibilityindicator': true })
                            .text('All')
                    )
                    .child(
                        $el('i')
                            .class({ 'material-icons-extended': true })
                            .text('keyboard_arrow_down')
                    )
                    .child(visibleDropdown)
            )
            .appendTo(root);

        const self = this;

        this.tagSelect = new Select(visibleDropdown.querySelector('select[name="tags"]'), {
            placeholder: 'Tags...',
            style: SelectStyle.DARK,
            onChange() {
                self.updateVisibility();
            },
        });

        this.onlineTypeSelect = new Select(visibleDropdown.querySelector('select[name="online-types"]'), {
            placeholder: 'Playstyles...',
            style: SelectStyle.DARK,
            onChange() {
                self.updateVisibility();
            },
        });

        $el('div')
            .class({ stadiaplus_libraryfilter: true })
            .child(this.searchColumn)
            .child(this.gameContainer)
            .appendTo(root);
    }

    getOrderDropdown(): HTMLElement {
        const dropdown = $el('div')
            .id(this.id + '-dropdown-' + Math.floor(Math.random() * 999999))
            .class({ 'stadiaplus_libraryfilter-dropdown': true });

        for (const order of FilterOrder.values()) {
            dropdown.child(
                $el('h6')
                    .text(order.name)
                    .css({ cursor: 'pointer', 'font-weight': '400' })
                    .event({
                        click: async () => {
                            await SyncStorage.LIBRARY_SORT_ORDER.set(order.id);
                            dropdown.class({ selected: false });
                            this.resortGames();
                        },
                    })
            );
        }

        return dropdown.element;
    }

    getVisibleDropdown(): HTMLElement {
        const tags = $el('select').attr({ name: 'tags', multiple: 'true' });

        for (const tag of StadiaGameDB.Tag.values()) {
            tags.child(
                $el('option')
                    .attr({ value: tag.id })
                    .text(tag.name)
            );
        }

        const onlineTypes = $el('select').attr({ name: 'online-types', multiple: 'true' });

        for (const type of StadiaGameDB.OnlineType.values()) {
            onlineTypes.child(
                $el('option')
                    .attr({ value: type.id })
                    .text(type.name)
            );
        }

        return $el('div')
            .id(this.id + '-dropdown-' + Math.floor(Math.random() * 999999))
            .class({ 'stadiaplus_libraryfilter-dropdown': true })
            .event({ click: (event) => event.stopPropagation() })
            .child(tags)
            .child(onlineTypes).element;
    }

    async getSortedGames(): Promise<LibraryGame[]> {
        const filter: FilterOrder = FilterOrder.from(await SyncStorage.LIBRARY_SORT_ORDER.get());
        const games = [...this.games]; // Shallow array clone
        const sorted = filter.sort(games);

        return sorted;
    }

    /**
     * Runs when the component is stopped, destroys necessary parts
     *
     * @memberof LibraryFilter
     */
    onStop(): void {
        this.active = false;
        Logger.component(Language.get('component.disabled', { name: this.name }));
    }

    /**
     * Runs every second, creates and updates elements.
     *
     * @memberof LibraryFilter
     */
    onUpdate(): void {
        if (Util.isInHome()) {
            if (!this.exists()) {
                this.updateRenderer();
            }
        }
    }
}

class LibraryGame {
    public name: string;
    public img: string;
    public uuid: string;
    public visible: boolean;

    constructor(uuid: string) {
        this.uuid = uuid;
        SyncStorage.LIBRARY_GAMES.get().then((libraryGames) => {
            if (libraryGames == null) libraryGames = [];

            const game = (libraryGames as LibraryGame[]).find((a) => a.uuid === uuid);
            if (game != null) {
                this.name = game.name;
                this.visible = game.visible;
            }
        });
    }

    async create() {
        this.visible = true;
        this.name = this.uuid;
        this.img = null;

        const game = StadiaGameDB.get(this.uuid);
        if (game !== undefined) {
            this.name = game.name;
            this.img = game.img;
        }
    }

    createTile(): HTMLElement {
        const element = $el('div')
            .class({ 'stadiaplus_libraryfilter-game': true })
            .attr({ 'data-uuid': this.uuid })
            .child(
                $el('img')
                    .class({ 'play-button': true })
                    .attr({ src: chrome.runtime.getURL('images/PlayButtonBackground.png') })
            )
            .child(
                $el('img')
                    .class({ 'play-icon': true })
                    .attr({ src: chrome.runtime.getURL('images/PlayButton.png') })
            )
            .child(
                $el('div')
                    .class({ content: true })
                    .child($el('h6').text(this.name))
            )
            .css({
                display: this.visible ? null : 'none',
                'background-image': this.img !== null ? `url(${this.img})` : null,
            }).element;

        return element;
    }
}

/**
 * Different types of filtering, represented as numbers
 *
 * @export the FilterOrder type
 * @class FilterOrder
 */
export class FilterOrder {
    public id: number;
    public name: string;
    public sort: (games: LibraryGame[]) => LibraryGame[];

    /**
     * Default Stadia sorting, recent/new games.
     *
     * @static
     * @memberof FilterOrder
     */
    static RECENT: FilterOrder = {
        id: 0,
        name: 'Recent',
        sort: FilterOrder.sortRecent,
    };

    /**
     * Alphabetical order.
     *
     * @static
     * @memberof FilterOrder
     */
    static ALPHABETICAL: FilterOrder = {
        id: 1,
        name: 'Alphabetical',
        sort: FilterOrder.sortAlphabetical,
    };

    /**
     * Random order.
     *
     * @static
     * @memberof FilterOrder
     */
    static RANDOM: FilterOrder = {
        id: 2,
        name: 'Random',
        sort: FilterOrder.sortRandom,
    };

    static from(id: number): FilterOrder {
        return this.values().find((e) => e.id === id);
    }

    static values() {
        return [FilterOrder.RECENT, FilterOrder.ALPHABETICAL, FilterOrder.RANDOM];
    }

    /**
     * Get the sorting method of the inputed order.
     *
     * @static
     * @returns a function sorting games by the inputed order.
     * @param {FilterOrder} order
     * @memberof FilterOrder
     */
    static getSorter(order: FilterOrder): Function {
        switch (order) {
            case this.RECENT:
                return this.sortRecent;

            case this.ALPHABETICAL:
                return this.sortAlphabetical;

            case this.RANDOM:
                return this.sortRandom;
        }
    }

    /**
     * Sort by recent games.
     *
     * @private
     * @static
     * @param {*} a
     * @param {*} b
     * @returns number representing which parameter is where.
     * @memberof FilterOrder
     */
    private static sortRecent(games: LibraryGame[]): LibraryGame[] {
        return games;
    }

    /**
     * Sort alphabetically.
     *
     * @private
     * @static
     * @param {*} a
     * @param {*} b
     * @returns number representing which parameter is where.
     * @memberof FilterOrder
     */
    private static sortAlphabetical(games: LibraryGame[]): LibraryGame[] {
        return games.sort((a, b) => a.name.localeCompare(b.name));
    }

    private static sortRandom(games: LibraryGame[]): LibraryGame[] {
        return Util.shuffle(games);
    }
}

/**
 * Enum containing different order directions
 *
 * @export the OrderDirection type.
 * @enum {number}
 */
export enum OrderDirection {
    ASCENDING,
    DESCENDING,
}
