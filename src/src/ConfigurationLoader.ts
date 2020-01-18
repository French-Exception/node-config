import {ConfigurationInterface} from "./ConfigurationInterface";
import * as fs from "fs-extra";
import {ConfigurationDeclarationInterface} from "./ConfigurationDeclarationInterface";
import {Configuration} from "./Configuration";
import {EventEmitter} from "events";
import {ConfigurationLoaderFromDeclarationRequestInterface} from "./ConfigurationLoaderFromDeclarationRequestInterface"
import {ConfigurationLoaderFromFileRequestInterface} from "./ConfigurationLoaderFromFileRequestInterface"

const path = require('path');

export class ConfigurationLoader extends EventEmitter {

    public async fromDeclaration(args: ConfigurationLoaderFromDeclarationRequestInterface): Promise<ConfigurationInterface> {
        const c = args.configuration = args.configuration || new Configuration({$: args.$, env: args.env});

        this.emit('fromDeclaration.start', args);

        await this.imports(args.declaration.imports, args.configuration, args.root);

        this.emit('fromDeclaration.stop', args);

        return c;
    }

    public async fromFile(args: ConfigurationLoaderFromFileRequestInterface): Promise<ConfigurationInterface> {
        if (!args.env) args.env = {};
        if (!args.file && !args.declaration) throw new Error('missing file and no declaration');
        if (!args.root) args.root = path.dirname(args.file);
        if (!path.isAbsolute(args.file) && !args.root) throw new Error('missing absolute file or root');

        args.configuration = args.configuration || new Configuration({env: args.env, $: args.$});

        const d = await this.loadJsonDeclaration(args.file);

        return await this.fromDeclaration({
            declaration: d,
            $: args.$,
            configuration: args.configuration,
            env: args.env,
            root: args.root
        })
    }

    protected async imports(imports: Array<string>, configuration: ConfigurationInterface, root: string): Promise<ConfigurationInterface> {
        if (imports && imports.length && imports.length > 0) {

            for (let key in imports) {
                const givenFile = (() => {
                    if (path.isAbsolute(imports[key]))
                        return imports[key];
                    return path.normalize(path.join(root, imports[key]));
                })();

                const interpolatedGivenFile = await configuration.interpolateString<string>(givenFile);
                const normalizedFile = path.normalize(<string>interpolatedGivenFile);


                const importedDeclaration: ConfigurationDeclarationInterface =
                    await this.loadJsonDeclaration(normalizedFile);

                this.emit('fromDeclaration.import', {
                    given: givenFile,
                    interpolated: interpolatedGivenFile,
                    normal: normalizedFile,
                    importedDeclaration: importedDeclaration
                });

                await configuration.merge(importedDeclaration.$);

                if (importedDeclaration.imports)
                    await this.imports(importedDeclaration.imports, configuration, root);
            }
        }

        return configuration;
    }

    protected async loadJsonDeclaration(file: string): Promise<ConfigurationDeclarationInterface> {
        const fileExtension = path.extname(file);
        const payload = await (async () => {
            switch (fileExtension) {
                case '.json':
                    const jsonRaw = await fs.readFile(file);
                    const jsonStr = jsonRaw.toString();
                    const json = JSON.parse(jsonStr);
                    return json;
                    break;
                case '.js':
                    // can be a simple JS object or a function returning a Promise
                    const loaded = require(file);
                    if ('function' === typeof loaded) {
                        const result = loaded();
                        if (result instanceof Promise) { //promise
                            return await <Promise<any>>result;
                        }
                        return result;
                    }
                    return loaded;
                    break;
                default:
                    throw new Error('invalid extension ' + fileExtension);
            }
        })();

        return <any>payload;
    }
}

