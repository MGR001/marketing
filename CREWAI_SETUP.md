# CrewAI marketing team setup

The marketing team runs locally through the Node app and the CrewAI Python framework. CrewAI currently requires Python 3.10–3.13; this project keeps its CrewAI runtime in a separate `.crew-env` environment so it does not change the timeline app's existing environment.

1. Install `uv` if needed: <https://docs.astral.sh/uv/getting-started/installation/>
2. From this project directory, create the supported Python environment and install the CrewAI dependency:

   ```sh
   uv venv --python 3.13 .crew-env
   uv pip install --python .crew-env/bin/python -r requirements-crewai.txt
   ```

3. Copy `.env.example` to `.env`, then set `OPENAI_API_KEY` to your own key. Keep this file private. You can change `OPENAI_MODEL` to another model supported by CrewAI's OpenAI provider.
4. Restart the local app with `npm start`, then open the Marketing team link beside Manage timeline.

The team does not need a separate search-provider key: its researcher works from the brief and clearly labels hypotheses rather than claiming it performed external research. Provider usage may incur API charges. The app binds to localhost and does not send the provider key to the browser.
